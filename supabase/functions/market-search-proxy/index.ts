/**
 * Market Search Proxy Edge Function
 * Unified search endpoint wrapping DB-first search + eBay/Amazon fallback
 * 
 * NOW uses the same DB-first approach as catalog-search for fast, accurate results.
 * Live API calls only happen when the database has insufficient results.
 * 
 * Features:
 * - DB-first search from catalog_items (instant, 200K+ items)
 * - French→English query translation
 * - Query expansion for broader matches
 * - Live eBay/Amazon fallback when DB < threshold
 * - Per-source caching with SHA-256 keys + stale-while-revalidate
 * - Rate limiting (60/5min per IP, 120/5min per user)
 * - Normalized response format
 */

import { createClient, SupabaseClient } from "@supabase/supabase-js";
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
  getCacheWithAge,
  setCachedResult,
  getProxyCacheSettings,
  SearchParams as CacheSearchParams,
  CachedPayload,
  ProxyCacheSettings,
} from "../_shared/proxyCache.ts";
import { getClientIp } from "../_shared/rateLimiter.ts";
import { searchDbFirst, DbFirstParams } from "../_shared/searchDbFirst.ts";
import { FR_EN_MAP } from "../_shared/frenchEnglishMap.ts";
import { isValidProductImageUrl } from "../_shared/imageValidator.ts";

// ─── Constants ───────────────────────────────────────────────────────────────

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Content-Type": "application/json",
};

const RATE_LIMIT_WINDOW_MINUTES = 5;
const RATE_LIMIT_IP = 60;
const RATE_LIMIT_USER = 120;
const DB_MIN_THRESHOLD = 5; // Below this, also try live APIs
const DEFAULT_LIMIT = 60;
const MAX_LIMIT = 200;

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
  sourceServed: ("ebay" | "amazon" | "db")[];
  page: number;
  limit: number;
  total: number;
  hasMore: boolean;
  items: NormalizedItem[];
  timingsMs: {
    db: number;
    ebay: number;
    amazon: number;
    total: number;
  };
  cache: {
    hit: boolean;
    ttlSeconds: number;
    stale?: boolean;
    ageSeconds?: number;
  };
  errors: { source: string; message: string }[];
}

interface FeatureFlag {
  key: string;
  platform: string;
  enabled: boolean;
}

// ─── Query Translation (French → English) ─────────────────────────────────────

function translateQuery(q: string): string {
  const words = q.toLowerCase().split(/\s+/);
  const translated = words.map(w => {
    for (const [fr, en] of Object.entries(FR_EN_MAP)) {
      if (w === fr.toLowerCase()) return en;
    }
    return w;
  });
  const result = translated.join(" ");
  return result !== q.toLowerCase() ? result : q;
}

// ─── DB item → NormalizedItem mapper ──────────────────────────────────────────

function mapDbItemToNormalized(item: Record<string, unknown>): NormalizedItem | null {
  const imageUrl = item.imageUrl as string || item.image_url as string || null;
  if (!imageUrl || !isValidProductImageUrl(imageUrl)) return null;
  const title = (item.title as string) || "";
  if (!title) return null;
  const price = Number(item.priceUsd || item.price_usd || 0);
  if (price <= 0) return null;

  return {
    id: String(item.id || ""),
    title,
    price,
    currency: (item.currency as string) || "USD",
    imageUrl,
    productUrl: (item.productUrl || item.product_url || "") as string,
    source: ((item.provider as string) || "ebay") as "ebay" | "amazon",
    condition: "used",
  };
}

// ─── Main Handler ────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  const startTime = Date.now();

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS });
  }

  if (req.method !== "GET") {
    return new Response(
      JSON.stringify({ error: "Method not allowed" }),
      { status: 405, headers: CORS_HEADERS }
    );
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const cacheSettings = await getProxyCacheSettings(supabase);

    // 1. Parse request
    const params = parseRequest(req);
    if ("error" in params) {
      return new Response(
        JSON.stringify({ error: params.error }),
        { status: 400, headers: CORS_HEADERS }
      );
    }

    const requestId = crypto.randomUUID().slice(0, 8);
    console.log("[SEARCH_PROXY] request", JSON.stringify({
      requestId,
      q: params.q,
      source: params.source,
      page: params.page,
      limit: params.limit,
      platform: params.clientPlatform,
    }));

    // 2. Rate limit
    const clientIp = getClientIp(req);
    const authHeader = req.headers.get("Authorization");
    const userId = await extractUserId(supabase, authHeader);
    const rateLimitResult = await checkRateLimit(supabase, clientIp, userId);
    if (!rateLimitResult.allowed) {
      return new Response(
        JSON.stringify({ error: "rate_limited", retry_after: rateLimitResult.retryAfter }),
        { status: 429, headers: { ...CORS_HEADERS, "Retry-After": rateLimitResult.retryAfter || "60" } }
      );
    }

    // 3. Feature flags
    const enabledSources = await getEnabledSources(supabase, params.source, params.clientPlatform);

    // 4. Translate query (French → English)
    const translatedQ = translateQuery(params.q);
    const qNorm = translatedQ.toLowerCase().replace(/\s+/g, " ").trim();
    if (translatedQ !== params.q) {
      console.log(`[SEARCH_PROXY] requestId=${requestId} translated: "${params.q}" → "${translatedQ}"`);
    }

    // 5. DB-FIRST SEARCH — query catalog_items for instant results
    const dbTimings = { start: Date.now(), duration: 0 };
    let dbItems: NormalizedItem[] = [];
    let dbTotal = 0;

    try {
      const dbParams: DbFirstParams = {
        supabase,
        qNorm,
        aiExpandedTerms: null,
        limit: params.limit,
        offset: (params.page - 1) * params.limit,
        categoryKey: params.category || null,
        requestId,
      };

      const dbResult = await searchDbFirst(dbParams);
      dbTimings.duration = Date.now() - dbTimings.start;

      const rawDbItems = dbResult.items || dbResult.fallbackItems || [];
      dbItems = rawDbItems
        .map((item: Record<string, unknown>) => mapDbItemToNormalized(item))
        .filter((item: NormalizedItem | null): item is NormalizedItem => item !== null);
      dbTotal = dbResult.dbCount;

      console.log(`[SEARCH_PROXY] requestId=${requestId} db_first tier=${dbResult.tier} count=${dbItems.length} dbTotal=${dbTotal} ms=${dbTimings.duration}`);
    } catch (dbErr) {
      dbTimings.duration = Date.now() - dbTimings.start;
      console.error(`[SEARCH_PROXY] requestId=${requestId} db_first_error`, dbErr);
    }

    // 6. LIVE API FALLBACK — only if DB returned too few results
    let liveItems: NormalizedItem[] = [];
    let anyCacheHit = false;
    let anyStale = false;
    let maxAgeSeconds = 0;
    const liveTimings = { ebay: 0, amazon: 0 };
    const errors: { source: string; message: string }[] = [];

    const needLiveFallback = dbItems.length < DB_MIN_THRESHOLD && enabledSources.length > 0;

    if (needLiveFallback) {
      console.log(`[SEARCH_PROXY] requestId=${requestId} live_fallback triggered (dbItems=${dbItems.length} < ${DB_MIN_THRESHOLD})`);

      const searchParams: CacheSearchParams = {
        q: translatedQ, // Use translated query for API calls
        minPrice: params.minPrice,
        maxPrice: params.maxPrice,
        condition: params.condition,
        sort: params.sort,
        limit: Math.min(params.limit, 50), // Live APIs still capped at 50
        page: params.page,
        currency: params.currency,
        country: params.country,
        category: params.category,
        clientPlatform: params.clientPlatform,
      };

      const results = await fetchFromProvidersWithSWR(supabase, enabledSources, searchParams, cacheSettings);

      for (const [source, result] of Object.entries(results)) {
        if (result.items.length > 0 || !result.error) {
          liveItems.push(...result.items);
          if (result.cacheHit) {
            anyCacheHit = true;
            if (result.stale) anyStale = true;
            if (result.ageSeconds && result.ageSeconds > maxAgeSeconds) {
              maxAgeSeconds = result.ageSeconds;
            }
          }
          liveTimings[source as "ebay" | "amazon"] = result.durationMs;
        }
        if (result.error) {
          errors.push({ source, message: result.error });
        }
      }
    }

    // 7. MERGE & DEDUPE — DB items first (more relevant), then live items
    const seenIds = new Set(dbItems.map(i => i.id));
    const uniqueLiveItems = liveItems.filter(i => {
      const key = i.id || `${i.title}-${i.price}`;
      if (seenIds.has(key)) return false;
      seenIds.add(key);
      return true;
    });

    const allItems = [...dbItems, ...uniqueLiveItems].slice(0, params.limit);
    const totalCount = Math.max(dbTotal, allItems.length);
    const sourceServed: ("ebay" | "amazon" | "db")[] = [];
    if (dbItems.length > 0) sourceServed.push("db");
    if (uniqueLiveItems.some(i => i.source === "ebay")) sourceServed.push("ebay");
    if (uniqueLiveItems.some(i => i.source === "amazon")) sourceServed.push("amazon");

    const response: SearchResponse = {
      query: params.q,
      sourceRequested: params.source,
      sourceServed,
      page: params.page,
      limit: params.limit,
      total: totalCount,
      hasMore: totalCount > params.page * params.limit,
      items: allItems,
      timingsMs: {
        db: dbTimings.duration,
        ebay: liveTimings.ebay,
        amazon: liveTimings.amazon,
        total: Date.now() - startTime,
      },
      cache: {
        hit: anyCacheHit || dbItems.length > 0,
        ttlSeconds: cacheSettings.searchTtlSeconds,
        ...(anyCacheHit && { stale: anyStale }),
        ...(maxAgeSeconds > 0 && { ageSeconds: maxAgeSeconds }),
      },
      errors,
    };

    console.log("[SEARCH_PROXY] response", JSON.stringify({
      requestId,
      items: allItems.length,
      dbItems: dbItems.length,
      liveItems: uniqueLiveItems.length,
      total: totalCount,
      hasMore: response.hasMore,
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

  const q = params.get("q")?.trim();
  if (!q || q.length < 1) return { error: "Missing required parameter: q" };
  if (q.length > 200) return { error: "Query too long (max 200 characters)" };

  const sourceRaw = params.get("source") || "both";
  if (!["ebay", "amazon", "both"].includes(sourceRaw)) {
    return { error: "Invalid source. Must be: ebay, amazon, or both" };
  }
  const source = sourceRaw as SourceType;

  let minPrice: number | undefined;
  let maxPrice: number | undefined;
  if (params.has("minPrice")) {
    minPrice = parseFloat(params.get("minPrice")!);
    if (isNaN(minPrice) || minPrice < 0) return { error: "Invalid minPrice" };
  }
  if (params.has("maxPrice")) {
    maxPrice = parseFloat(params.get("maxPrice")!);
    if (isNaN(maxPrice) || maxPrice < 0) return { error: "Invalid maxPrice" };
  }
  if (minPrice !== undefined && maxPrice !== undefined && minPrice > maxPrice) {
    return { error: "minPrice cannot be greater than maxPrice" };
  }

  const conditionRaw = params.get("condition") || "any";
  if (!["new", "used", "refurbished", "any"].includes(conditionRaw)) {
    return { error: "Invalid condition" };
  }
  const condition = conditionRaw as ConditionType;

  const sortRaw = params.get("sort") || "best";
  if (!["best", "price_asc", "price_desc", "newly_listed"].includes(sortRaw)) {
    return { error: "Invalid sort" };
  }
  const sort = sortRaw as SortType;

  // Increased limit: default 60, max 200
  let limit = DEFAULT_LIMIT;
  if (params.has("limit")) {
    limit = parseInt(params.get("limit")!, 10);
    if (isNaN(limit) || limit < 1 || limit > MAX_LIMIT) {
      limit = Math.min(Math.max(limit || DEFAULT_LIMIT, 1), MAX_LIMIT);
    }
  }

  let page = 1;
  if (params.has("page")) {
    page = parseInt(params.get("page")!, 10);
    if (isNaN(page) || page < 1) page = 1;
  }

  const currency = params.get("currency")?.toUpperCase() || "USD";
  const country = params.get("country")?.toUpperCase() || "US";
  const category = params.get("category") || undefined;

  const platformRaw = params.get("clientPlatform");
  let clientPlatform: "ios" | "android" | "web" | undefined;
  if (platformRaw && ["ios", "android", "web"].includes(platformRaw)) {
    clientPlatform = platformRaw as "ios" | "android" | "web";
  }

  return { q, source, minPrice, maxPrice, condition, sort, limit, page, currency, country, category, clientPlatform };
}

// ─── Authentication ──────────────────────────────────────────────────────────

async function extractUserId(supabase: any, authHeader: string | null): Promise<string | null> {
  if (!authHeader?.startsWith("Bearer ")) return null;
  try {
    const token = authHeader.replace("Bearer ", "");
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data.user) return null;
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

async function checkRateLimit(supabase: any, clientIp: string, userId: string | null): Promise<RateLimitResult> {
  try {
    const ipKey = `ip:${clientIp}:market-search`;
    const { data: ipResult, error: ipError } = await supabase.rpc("check_rate_limit", {
      p_key: ipKey, p_limit: RATE_LIMIT_IP, p_window_minutes: RATE_LIMIT_WINDOW_MINUTES,
    }) as { data: RateLimitRpcResult | null; error: Error | null };

    if (ipError) return { allowed: true, key: ipKey };
    if (!ipResult?.allowed) return { allowed: false, blockedBy: "ip", retryAfter: ipResult?.reset_at, key: ipKey };

    if (userId) {
      const userKey = `user:${userId}:market-search`;
      const { data: userResult, error: userError } = await supabase.rpc("check_rate_limit", {
        p_key: userKey, p_limit: RATE_LIMIT_USER, p_window_minutes: RATE_LIMIT_WINDOW_MINUTES,
      }) as { data: RateLimitRpcResult | null; error: Error | null };

      if (userError) return { allowed: true, remaining: ipResult.remaining, key: userKey };
      if (!userResult?.allowed) return { allowed: false, blockedBy: "user", retryAfter: userResult?.reset_at, key: userKey };
      return { allowed: true, remaining: Math.min(ipResult.remaining, userResult.remaining), key: userKey };
    }

    return { allowed: true, remaining: ipResult.remaining, key: ipKey };
  } catch {
    return { allowed: true };
  }
}

// ─── Feature Flags ───────────────────────────────────────────────────────────

interface FeatureFlagRow { key: string; platform: string; enabled: boolean; }

async function getEnabledSources(supabase: any, requestedSource: SourceType, clientPlatform?: string): Promise<("ebay" | "amazon")[]> {
  try {
    const platforms = ["all"];
    if (clientPlatform) platforms.push(clientPlatform);

    const { data: flags, error } = await supabase
      .from("feature_flags")
      .select("key, platform, enabled")
      .in("key", ["enable_amazon", "enable_ebay"])
      .in("platform", platforms) as { data: FeatureFlagRow[] | null; error: Error | null };

    if (error) {
      return requestedSource === "ebay" ? ["ebay"] : requestedSource === "amazon" ? ["amazon"] : ["ebay", "amazon"];
    }

    const resolveFlag = (key: string): boolean => {
      const allFlag = flags?.find((f: FeatureFlagRow) => f.key === key && f.platform === "all");
      const platformFlag = clientPlatform ? flags?.find((f: FeatureFlagRow) => f.key === key && f.platform === clientPlatform) : null;
      if (platformFlag) return platformFlag.enabled;
      if (allFlag) return allFlag.enabled;
      return true;
    };

    const sources: ("ebay" | "amazon")[] = [];
    if ((requestedSource === "both" || requestedSource === "ebay") && resolveFlag("enable_ebay")) sources.push("ebay");
    if ((requestedSource === "both" || requestedSource === "amazon") && resolveFlag("enable_amazon")) sources.push("amazon");
    return sources;
  } catch {
    return requestedSource === "ebay" ? ["ebay"] : requestedSource === "amazon" ? ["amazon"] : ["ebay", "amazon"];
  }
}

// ─── Provider Fetching with Stale-While-Revalidate ───────────────────────────

interface ProviderFetchResult {
  items: NormalizedItem[];
  total: number;
  hasMore: boolean;
  durationMs: number;
  error: string | null;
  cacheHit: boolean;
  stale?: boolean;
  ageSeconds?: number;
}

async function fetchFromProvidersWithSWR(
  supabase: SupabaseClient,
  enabledSources: ("ebay" | "amazon")[],
  params: CacheSearchParams,
  settings: ProxyCacheSettings
): Promise<Record<"ebay" | "amazon", ProviderFetchResult>> {
  const results: Record<"ebay" | "amazon", ProviderFetchResult> = {
    ebay: { items: [], total: 0, hasMore: false, durationMs: 0, error: null, cacheHit: false },
    amazon: { items: [], total: 0, hasMore: false, durationMs: 0, error: null, cacheHit: false },
  };

  const fetchPromises: Promise<void>[] = [];

  for (const source of enabledSources) {
    fetchPromises.push(
      (async () => {
        const cacheKey = await generateCacheKey(source, params);
        const cacheResult = await getCacheWithAge(supabase, cacheKey, settings.searchTtlSeconds, settings.staleMaxSeconds);

        if (cacheResult) {
          results[source] = {
            items: cacheResult.payload.items as NormalizedItem[],
            total: cacheResult.payload.total,
            hasMore: cacheResult.payload.hasMore,
            durationMs: 0,
            error: null,
            cacheHit: true,
            stale: cacheResult.isStale,
            ageSeconds: cacheResult.ageSeconds,
          };

          if (cacheResult.isStale) {
            triggerBackgroundRefresh(supabase, source, params, cacheKey, settings.searchTtlSeconds);
          }
          return;
        }

        const fetchStart = Date.now();
        let providerResult;
        if (source === "ebay") {
          providerResult = await searchEbayNormalized(supabase, {
            q: params.q, minPrice: params.minPrice, maxPrice: params.maxPrice,
            condition: params.condition as ConditionType, sort: params.sort as SortType,
            limit: params.limit, page: params.page, currency: params.currency,
            country: params.country, category: params.category,
          });
        } else {
          providerResult = await searchAmazonNormalized({
            q: params.q, minPrice: params.minPrice, maxPrice: params.maxPrice,
            condition: params.condition as ConditionType, sort: params.sort as SortType,
            limit: params.limit, page: params.page, currency: params.currency,
            country: params.country, category: params.category,
          });
        }

        results[source] = { ...providerResult, durationMs: Date.now() - fetchStart, cacheHit: false };

        if (!providerResult.error && providerResult.items.length > 0) {
          const cachePayload: CachedPayload = {
            items: providerResult.items, total: providerResult.total,
            hasMore: providerResult.hasMore, fetchedAt: new Date().toISOString(),
          };
          await setCachedResult(supabase, cacheKey, source, cachePayload, settings.searchTtlSeconds);
        }
      })()
    );
  }

  await Promise.all(fetchPromises);
  return results;
}

function triggerBackgroundRefresh(
  supabase: SupabaseClient, source: "ebay" | "amazon",
  params: CacheSearchParams, cacheKey: string, ttlSeconds: number
): void {
  (async () => {
    try {
      const startTime = Date.now();
      let providerResult;
      if (source === "ebay") {
        providerResult = await searchEbayNormalized(supabase, {
          q: params.q, minPrice: params.minPrice, maxPrice: params.maxPrice,
          condition: params.condition as ConditionType, sort: params.sort as SortType,
          limit: params.limit, page: params.page, currency: params.currency,
          country: params.country, category: params.category,
        });
      } else {
        providerResult = await searchAmazonNormalized({
          q: params.q, minPrice: params.minPrice, maxPrice: params.maxPrice,
          condition: params.condition as ConditionType, sort: params.sort as SortType,
          limit: params.limit, page: params.page, currency: params.currency,
          country: params.country, category: params.category,
        });
      }
      if (!providerResult.error && providerResult.items.length > 0) {
        const cachePayload: CachedPayload = {
          items: providerResult.items, total: providerResult.total,
          hasMore: providerResult.hasMore, fetchedAt: new Date().toISOString(),
        };
        await setCachedResult(supabase, cacheKey, source, cachePayload, ttlSeconds);
      }
    } catch (err) {
      console.error("[SEARCH_PROXY] refresh_error", err);
    }
  })();
}
