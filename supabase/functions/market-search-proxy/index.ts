/**
 * Market Search Proxy Edge Function
 * Unified search endpoint wrapping eBay and Amazon APIs
 * 
 * Features:
 * - Platform gating via feature_flags table
 * - Per-source caching with SHA-256 keys
 * - Rate limiting (60/5min per IP, 120/5min per user)
 * - Normalized response format
 * - Structured logging
 * 
 * Test examples:
 * - eBay only: /market-search-proxy?q=iphone&maxPrice=200&source=ebay&limit=24&page=1
 * - Both providers: /market-search-proxy?q=iphone&maxPrice=200&source=both
 * - iOS gating: /market-search-proxy?q=iphone&source=both&clientPlatform=ios
 * - Pagination: ?q=laptop&page=1&limit=24 then ?q=laptop&page=2&limit=24
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { 
  searchEbayNormalized, 
  searchAmazonNormalized, 
  NormalizedItem,
  SourceType,
  ConditionType,
  SortType,
} from "../_shared/proxyProviders.ts";
import {
  generateCacheKey,
  getCachedResult,
  setCachedResult,
  SearchParams as CacheSearchParams,
  CachedPayload,
} from "../_shared/proxyCache.ts";
import { getClientIp } from "../_shared/rateLimiter.ts";

// ─── Constants ───────────────────────────────────────────────────────────────

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Content-Type": "application/json",
};

const RATE_LIMIT_WINDOW_MINUTES = 5;
const RATE_LIMIT_IP = 60;
const RATE_LIMIT_USER = 120;
const CACHE_TTL_SECONDS = 900; // 15 minutes

// ─── Types ───────────────────────────────────────────────────────────────────

interface SearchRequest {
  q: string;
  source: SourceType;
  minPrice?: number;
  maxPrice?: number;
  condition: ConditionType;
  sort: SortType;
  limit: number;
  page: number;
  currency: string;
  country: string;
  category?: string;
  clientPlatform?: "ios" | "android" | "web";
}

interface SearchResponse {
  query: string;
  sourceRequested: SourceType;
  sourceServed: ("ebay" | "amazon")[];
  page: number;
  limit: number;
  hasMore: boolean;
  items: NormalizedItem[];
  timingsMs: {
    ebay: number;
    amazon: number;
    total: number;
  };
  cache: {
    hit: boolean;
    ttlSeconds: number;
  };
  errors: { source: string; message: string }[];
}

interface FeatureFlag {
  key: string;
  platform: string;
  enabled: boolean;
}

// ─── Main Handler ────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  const startTime = Date.now();

  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS });
  }

  // Only allow GET
  if (req.method !== "GET") {
    return new Response(
      JSON.stringify({ error: "Method not allowed" }),
      { status: 405, headers: CORS_HEADERS }
    );
  }

  try {
    // Initialize Supabase client (service role for accessing protected tables)
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // 1. Parse and validate request
    const params = parseRequest(req);
    if ("error" in params) {
      return new Response(
        JSON.stringify({ error: params.error }),
        { status: 400, headers: CORS_HEADERS }
      );
    }

    console.log("[SEARCH_PROXY] request", JSON.stringify({
      q: params.q,
      source: params.source,
      page: params.page,
      limit: params.limit,
      platform: params.clientPlatform,
    }));

    // 2. Rate limit check
    const clientIp = getClientIp(req);
    const authHeader = req.headers.get("Authorization");
    const userId = await extractUserId(supabase, authHeader);

    const rateLimitResult = await checkRateLimit(supabase, clientIp, userId);
    if (!rateLimitResult.allowed) {
      console.log("[SEARCH_PROXY] rate_limit", JSON.stringify({
        allowed: false,
        blockedBy: rateLimitResult.blockedBy,
        key: rateLimitResult.key,
      }));
      return new Response(
        JSON.stringify({ 
          error: "rate_limited",
          retry_after: rateLimitResult.retryAfter,
        }),
        { 
          status: 429, 
          headers: {
            ...CORS_HEADERS,
            "Retry-After": rateLimitResult.retryAfter || "60",
          },
        }
      );
    }

    console.log("[SEARCH_PROXY] rate_limit", JSON.stringify({
      allowed: true,
      remaining: rateLimitResult.remaining,
      key: rateLimitResult.key,
    }));

    // 3. Feature flag check
    const enabledSources = await getEnabledSources(
      supabase,
      params.source,
      params.clientPlatform
    );

    console.log("[SEARCH_PROXY] feature_check", JSON.stringify({
      amazon: enabledSources.includes("amazon"),
      ebay: enabledSources.includes("ebay"),
      platform: params.clientPlatform || "all",
    }));

    // If no sources enabled, return empty results
    if (enabledSources.length === 0) {
      const response: SearchResponse = {
        query: params.q,
        sourceRequested: params.source,
        sourceServed: [],
        page: params.page,
        limit: params.limit,
        hasMore: false,
        items: [],
        timingsMs: { ebay: 0, amazon: 0, total: Date.now() - startTime },
        cache: { hit: false, ttlSeconds: CACHE_TTL_SECONDS },
        errors: [{ source: "all", message: "No search providers available" }],
      };
      return new Response(JSON.stringify(response), { headers: CORS_HEADERS });
    }

    // 4. Build search params for cache and providers
    const searchParams: CacheSearchParams = {
      q: params.q,
      minPrice: params.minPrice,
      maxPrice: params.maxPrice,
      condition: params.condition,
      sort: params.sort,
      limit: params.limit,
      page: params.page,
      currency: params.currency,
      country: params.country,
      category: params.category,
      clientPlatform: params.clientPlatform,
    };

    // 5. Check cache and fetch from providers
    const results = await fetchFromProviders(
      supabase,
      enabledSources,
      searchParams
    );

    // 6. Build response
    const allItems: NormalizedItem[] = [];
    const sourceServed: ("ebay" | "amazon")[] = [];
    const errors: { source: string; message: string }[] = [];
    let hasAnyMore = false;
    let anyCacheHit = false;

    for (const [source, result] of Object.entries(results)) {
      if (result.items.length > 0 || !result.error) {
        sourceServed.push(source as "ebay" | "amazon");
        allItems.push(...result.items);
        if (result.hasMore) hasAnyMore = true;
        if (result.cacheHit) anyCacheHit = true;
      }
      if (result.error) {
        errors.push({ source, message: result.error });
      }
    }

    // Sort combined results by relevance (interleave sources)
    const sortedItems = interleaveResults(allItems, params.limit);

    const response: SearchResponse = {
      query: params.q,
      sourceRequested: params.source,
      sourceServed,
      page: params.page,
      limit: params.limit,
      hasMore: hasAnyMore,
      items: sortedItems,
      timingsMs: {
        ebay: results.ebay?.durationMs || 0,
        amazon: results.amazon?.durationMs || 0,
        total: Date.now() - startTime,
      },
      cache: {
        hit: anyCacheHit,
        ttlSeconds: CACHE_TTL_SECONDS,
      },
      errors,
    };

    console.log("[SEARCH_PROXY] response", JSON.stringify({
      items: sortedItems.length,
      hasMore: hasAnyMore,
      totalMs: response.timingsMs.total,
      sourceServed,
    }));

    return new Response(JSON.stringify(response), { headers: CORS_HEADERS });

  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error("[SEARCH_PROXY] error", errorMsg);
    
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: CORS_HEADERS }
    );
  }
});

// ─── Request Parsing ─────────────────────────────────────────────────────────

function parseRequest(req: Request): SearchRequest | { error: string } {
  const url = new URL(req.url);
  const params = url.searchParams;

  // Required: q
  const q = params.get("q")?.trim();
  if (!q || q.length < 1) {
    return { error: "Missing required parameter: q" };
  }
  if (q.length > 200) {
    return { error: "Query too long (max 200 characters)" };
  }

  // Optional: source
  const sourceRaw = params.get("source") || "both";
  if (!["ebay", "amazon", "both"].includes(sourceRaw)) {
    return { error: "Invalid source. Must be: ebay, amazon, or both" };
  }
  const source = sourceRaw as SourceType;

  // Optional: minPrice / maxPrice
  let minPrice: number | undefined;
  let maxPrice: number | undefined;
  
  if (params.has("minPrice")) {
    minPrice = parseFloat(params.get("minPrice")!);
    if (isNaN(minPrice) || minPrice < 0) {
      return { error: "Invalid minPrice. Must be a positive number" };
    }
  }
  
  if (params.has("maxPrice")) {
    maxPrice = parseFloat(params.get("maxPrice")!);
    if (isNaN(maxPrice) || maxPrice < 0) {
      return { error: "Invalid maxPrice. Must be a positive number" };
    }
  }
  
  if (minPrice !== undefined && maxPrice !== undefined && minPrice > maxPrice) {
    return { error: "minPrice cannot be greater than maxPrice" };
  }

  // Optional: condition
  const conditionRaw = params.get("condition") || "any";
  if (!["new", "used", "refurbished", "any"].includes(conditionRaw)) {
    return { error: "Invalid condition. Must be: new, used, refurbished, or any" };
  }
  const condition = conditionRaw as ConditionType;

  // Optional: sort
  const sortRaw = params.get("sort") || "best";
  if (!["best", "price_asc", "price_desc", "newly_listed"].includes(sortRaw)) {
    return { error: "Invalid sort. Must be: best, price_asc, price_desc, or newly_listed" };
  }
  const sort = sortRaw as SortType;

  // Optional: limit (default 24, max 50)
  let limit = 24;
  if (params.has("limit")) {
    limit = parseInt(params.get("limit")!, 10);
    if (isNaN(limit) || limit < 1 || limit > 50) {
      return { error: "Invalid limit. Must be between 1 and 50" };
    }
  }

  // Optional: page (default 1)
  let page = 1;
  if (params.has("page")) {
    page = parseInt(params.get("page")!, 10);
    if (isNaN(page) || page < 1) {
      return { error: "Invalid page. Must be a positive integer" };
    }
  }

  // Optional: currency (default USD)
  const currency = params.get("currency")?.toUpperCase() || "USD";
  if (currency.length !== 3) {
    return { error: "Invalid currency. Must be a 3-letter code" };
  }

  // Optional: country (default US)
  const country = params.get("country")?.toUpperCase() || "US";
  if (country.length !== 2) {
    return { error: "Invalid country. Must be a 2-letter code" };
  }

  // Optional: category
  const category = params.get("category") || undefined;

  // Optional: clientPlatform
  const platformRaw = params.get("clientPlatform");
  let clientPlatform: "ios" | "android" | "web" | undefined;
  if (platformRaw) {
    if (!["ios", "android", "web"].includes(platformRaw)) {
      return { error: "Invalid clientPlatform. Must be: ios, android, or web" };
    }
    clientPlatform = platformRaw as "ios" | "android" | "web";
  }

  return {
    q,
    source,
    minPrice,
    maxPrice,
    condition,
    sort,
    limit,
    page,
    currency,
    country,
    category,
    clientPlatform,
  };
}

// ─── Authentication ──────────────────────────────────────────────────────────

async function extractUserId(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  authHeader: string | null
): Promise<string | null> {
  if (!authHeader?.startsWith("Bearer ")) {
    return null;
  }

  try {
    const token = authHeader.replace("Bearer ", "");
    const { data, error } = await supabase.auth.getUser(token);
    
    if (error || !data.user) {
      return null;
    }
    
    return data.user.id;
  } catch {
    return null;
  }
}

// ─── Rate Limiting ───────────────────────────────────────────────────────────

interface RateLimitResult {
  allowed: boolean;
  remaining?: number;
  blockedBy?: "ip" | "user";
  retryAfter?: string;
  key?: string;
}

interface RateLimitRpcResult {
  allowed: boolean;
  remaining: number;
  reset_at: string;
}

async function checkRateLimit(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  clientIp: string,
  userId: string | null
): Promise<RateLimitResult> {
  try {
    // Check IP rate limit
    const ipKey = `ip:${clientIp}:market-search`;
    const { data: ipResult, error: ipError } = await supabase.rpc("check_rate_limit", {
      p_key: ipKey,
      p_limit: RATE_LIMIT_IP,
      p_window_minutes: RATE_LIMIT_WINDOW_MINUTES,
    }) as { data: RateLimitRpcResult | null; error: Error | null };

    if (ipError) {
      console.error("[SEARCH_PROXY] rate_limit_error", ipError.message);
      // Fail open on error
      return { allowed: true, key: ipKey };
    }

    if (!ipResult?.allowed) {
      return {
        allowed: false,
        blockedBy: "ip",
        retryAfter: ipResult?.reset_at,
        key: ipKey,
      };
    }

    // If authenticated, also check user rate limit
    if (userId) {
      const userKey = `user:${userId}:market-search`;
      const { data: userResult, error: userError } = await supabase.rpc("check_rate_limit", {
        p_key: userKey,
        p_limit: RATE_LIMIT_USER,
        p_window_minutes: RATE_LIMIT_WINDOW_MINUTES,
      }) as { data: RateLimitRpcResult | null; error: Error | null };

      if (userError) {
        console.error("[SEARCH_PROXY] rate_limit_error", userError.message);
        // Fail open on error
        return { allowed: true, remaining: ipResult.remaining, key: userKey };
      }

      if (!userResult?.allowed) {
        return {
          allowed: false,
          blockedBy: "user",
          retryAfter: userResult?.reset_at,
          key: userKey,
        };
      }

      return { 
        allowed: true, 
        remaining: Math.min(ipResult.remaining, userResult.remaining),
        key: userKey,
      };
    }

    return { 
      allowed: true, 
      remaining: ipResult.remaining,
      key: ipKey,
    };
  } catch (err) {
    console.error("[SEARCH_PROXY] rate_limit_exception", err);
    // Fail open on exception
    return { allowed: true };
  }
}

// ─── Feature Flags ───────────────────────────────────────────────────────────

interface FeatureFlagRow {
  key: string;
  platform: string;
  enabled: boolean;
}

async function getEnabledSources(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  requestedSource: SourceType,
  clientPlatform?: string
): Promise<("ebay" | "amazon")[]> {
  try {
    // Build list of platforms to check
    const platforms = ["all"];
    if (clientPlatform) {
      platforms.push(clientPlatform);
    }

    // Fetch all relevant flags
    const { data: flags, error } = await supabase
      .from("feature_flags")
      .select("key, platform, enabled")
      .in("key", ["enable_amazon", "enable_ebay"])
      .in("platform", platforms) as { data: FeatureFlagRow[] | null; error: Error | null };

    if (error) {
      console.error("[SEARCH_PROXY] feature_flags_error", error.message);
      // Default to both enabled on error
      return requestedSource === "ebay" ? ["ebay"] : 
             requestedSource === "amazon" ? ["amazon"] : 
             ["ebay", "amazon"];
    }

    // Resolve flags (platform-specific overrides 'all')
    const resolveFlag = (key: string): boolean => {
      const allFlag = flags?.find((f: FeatureFlagRow) => f.key === key && f.platform === "all");
      const platformFlag = clientPlatform 
        ? flags?.find((f: FeatureFlagRow) => f.key === key && f.platform === clientPlatform)
        : null;
      
      // Platform-specific takes precedence
      if (platformFlag) {
        return platformFlag.enabled;
      }
      // Fall back to 'all' flag
      if (allFlag) {
        return allFlag.enabled;
      }
      // Default to enabled if no flag exists
      return true;
    };

    const amazonEnabled = resolveFlag("enable_amazon");
    const ebayEnabled = resolveFlag("enable_ebay");

    // Filter based on requested source
    const sources: ("ebay" | "amazon")[] = [];
    
    if (requestedSource === "both" || requestedSource === "ebay") {
      if (ebayEnabled) sources.push("ebay");
    }
    if (requestedSource === "both" || requestedSource === "amazon") {
      if (amazonEnabled) sources.push("amazon");
    }

    return sources;
  } catch (err) {
    console.error("[SEARCH_PROXY] feature_flags_exception", err);
    // Default to requested sources on exception
    return requestedSource === "ebay" ? ["ebay"] : 
           requestedSource === "amazon" ? ["amazon"] : 
           ["ebay", "amazon"];
  }
}

// ─── Provider Fetching ───────────────────────────────────────────────────────

interface ProviderFetchResult {
  items: NormalizedItem[];
  total: number;
  hasMore: boolean;
  durationMs: number;
  error: string | null;
  cacheHit: boolean;
}

async function fetchFromProviders(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  enabledSources: ("ebay" | "amazon")[],
  params: CacheSearchParams
): Promise<Record<"ebay" | "amazon", ProviderFetchResult>> {
  const results: Record<"ebay" | "amazon", ProviderFetchResult> = {
    ebay: { items: [], total: 0, hasMore: false, durationMs: 0, error: null, cacheHit: false },
    amazon: { items: [], total: 0, hasMore: false, durationMs: 0, error: null, cacheHit: false },
  };

  // Fetch from each enabled source in parallel
  const fetchPromises: Promise<void>[] = [];

  for (const source of enabledSources) {
    fetchPromises.push(
      (async () => {
        const cacheKey = await generateCacheKey(source, params);
        
        // Check cache first
        const cached = await getCachedResult(supabase, cacheKey);
        if (cached) {
          console.log("[SEARCH_PROXY] cache_hit", JSON.stringify({
            source,
            cacheKey: cacheKey.slice(0, 20),
          }));
          
          results[source] = {
            items: cached.items as NormalizedItem[],
            total: cached.total,
            hasMore: cached.hasMore,
            durationMs: 0,
            error: null,
            cacheHit: true,
          };
          return;
        }

        console.log("[SEARCH_PROXY] cache_miss", JSON.stringify({
          source,
          cacheKey: cacheKey.slice(0, 20),
        }));

        // Fetch from provider
        let providerResult;
        if (source === "ebay") {
          providerResult = await searchEbayNormalized(supabase, {
            q: params.q,
            minPrice: params.minPrice,
            maxPrice: params.maxPrice,
            condition: params.condition as ConditionType,
            sort: params.sort as SortType,
            limit: params.limit,
            page: params.page,
            currency: params.currency,
            country: params.country,
            category: params.category,
          });
        } else {
          providerResult = await searchAmazonNormalized({
            q: params.q,
            minPrice: params.minPrice,
            maxPrice: params.maxPrice,
            condition: params.condition as ConditionType,
            sort: params.sort as SortType,
            limit: params.limit,
            page: params.page,
            currency: params.currency,
            country: params.country,
            category: params.category,
          });
        }

        results[source] = {
          ...providerResult,
          cacheHit: false,
        };

        // Cache successful results
        if (!providerResult.error && providerResult.items.length > 0) {
          const cachePayload: CachedPayload = {
            items: providerResult.items,
            total: providerResult.total,
            hasMore: providerResult.hasMore,
            fetchedAt: new Date().toISOString(),
          };
          await setCachedResult(supabase, cacheKey, source, cachePayload, CACHE_TTL_SECONDS);
        }
      })()
    );
  }

  await Promise.all(fetchPromises);

  return results;
}

// ─── Result Interleaving ─────────────────────────────────────────────────────

/**
 * Interleave results from different sources to provide variety
 * Uses round-robin approach: ebay[0], amazon[0], ebay[1], amazon[1], ...
 */
function interleaveResults(
  items: NormalizedItem[],
  limit: number
): NormalizedItem[] {
  const ebayItems = items.filter(i => i.source === "ebay");
  const amazonItems = items.filter(i => i.source === "amazon");
  
  const result: NormalizedItem[] = [];
  const maxLen = Math.max(ebayItems.length, amazonItems.length);
  
  for (let i = 0; i < maxLen && result.length < limit; i++) {
    if (i < ebayItems.length) {
      result.push(ebayItems[i]);
    }
    if (result.length < limit && i < amazonItems.length) {
      result.push(amazonItems[i]);
    }
  }
  
  return result.slice(0, limit);
}
