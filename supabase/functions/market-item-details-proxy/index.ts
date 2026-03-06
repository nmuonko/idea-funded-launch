/**
 * Market Item Details Proxy Edge Function
 * Unified item details endpoint wrapping eBay and Amazon APIs
 * 
 * Features:
 * - Returns ALL item images (imageUrls array)
 * - Per-item caching with admin-controlled TTL + stale-while-revalidate
 * - Rate limiting (60/5min per IP)
 * - Normalized response format
 * - Structured logging
 * 
 * Test examples:
 * - eBay item: /market-item-details-proxy?source=ebay&id=v1|123456|0
 * - Amazon item: /market-item-details-proxy?source=amazon&id=B09V3KXJPB
 */

import { createClient, SupabaseClient } from "@supabase/supabase-js";
import {
  getEbayItemNormalized,
  getAmazonItemNormalized,
  NormalizedItemDetail,
} from "../_shared/proxyProviders.ts";
import { getProxyCacheSettings, ProxyCacheSettings } from "../_shared/proxyCache.ts";
import { getClientIp } from "../_shared/rateLimiter.ts";

// ─── Constants ───────────────────────────────────────────────────────────────

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Content-Type": "application/json",
};

const RATE_LIMIT_WINDOW_MINUTES = 5;
const RATE_LIMIT_IP = 60;
const MAX_IMAGES = 20; // Limit imageUrls to avoid huge payloads

// ─── Types ───────────────────────────────────────────────────────────────────

interface ItemDetailsRequest {
  source: "ebay" | "amazon";
  id: string;
}

interface ItemDetailsResponse {
  source: "ebay" | "amazon";
  externalId: string;
  title: string;
  price: number;
  currency: string;
  imageUrl: string | null;
  imageUrls: string[];
  itemUrl: string;
  condition: "new" | "used" | "refurbished" | "unknown";
  shippingPrice: number;
  sellerName: string | null;
  location: string | null;
  description: string | null;
  attributes: Record<string, string>;
  inStock: boolean;
  timingsMs: number;
  cache: {
    hit: boolean;
    ttlSeconds: number;
    stale?: boolean;
    ageSeconds?: number;
  };
}

interface CachedItemDetail {
  item: NormalizedItemDetail;
  fetchedAt: string;
}

interface CacheResultWithAge {
  payload: CachedItemDetail;
  createdAt: Date;
  expiresAt: Date;
  ageSeconds: number;
  isExpired: boolean;
  isStale: boolean;
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

    // Load cache settings from admin_settings
    const cacheSettings = await getProxyCacheSettings(supabase);
    
    console.log("[ITEM_DETAILS_PROXY] settings", JSON.stringify({
      ttlFresh: cacheSettings.itemTtlSeconds,
      ttlStaleMax: cacheSettings.staleMaxSeconds,
    }));

    // 1. Parse and validate request
    const params = parseRequest(req);
    if ("error" in params) {
      return new Response(
        JSON.stringify({ error: params.error }),
        { status: 400, headers: CORS_HEADERS }
      );
    }

    console.log("[ITEM_DETAILS_PROXY] request", JSON.stringify({
      source: params.source,
      id: params.id.slice(0, 30),
    }));

    // 2. Rate limit check
    const clientIp = getClientIp(req);
    const rateLimitResult = await checkRateLimit(supabase, clientIp);
    if (!rateLimitResult.allowed) {
      console.log("[ITEM_DETAILS_PROXY] rate_limit", JSON.stringify({
        allowed: false,
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

    // 3. Check cache with stale-while-revalidate
    const cacheKey = `detail:${params.source}:${params.id}`;
    const cacheResult = await getCacheWithAge(supabase, cacheKey, cacheSettings);
    
    if (cacheResult) {
      console.log("[ITEM_DETAILS_PROXY] cache_hit", JSON.stringify({
        cacheKey: cacheKey.slice(0, 40),
        stale: cacheResult.isStale,
        ageSeconds: cacheResult.ageSeconds,
      }));
      
      const response = buildResponse(
        cacheResult.payload.item, 
        Date.now() - startTime, 
        true,
        cacheResult.isStale,
        cacheResult.ageSeconds,
        cacheSettings.itemTtlSeconds
      );
      
      // If stale, trigger background refresh
      if (cacheResult.isStale) {
        console.log("[ITEM_DETAILS_PROXY] refresh_started", JSON.stringify({
          source: params.source,
          id: params.id.slice(0, 20),
        }));
        
        triggerBackgroundRefresh(
          supabase,
          params.source,
          params.id,
          cacheKey,
          cacheSettings.itemTtlSeconds
        );
      }
      
      return new Response(JSON.stringify(response), { headers: CORS_HEADERS });
    }

    console.log("[ITEM_DETAILS_PROXY] cache_miss", JSON.stringify({
      cacheKey: cacheKey.slice(0, 40),
    }));

    // 4. Fetch from provider
    let item: NormalizedItemDetail | null = null;
    let error: string | null = null;

    if (params.source === "ebay") {
      const result = await getEbayItemNormalized(supabase, params.id);
      item = result.item;
      error = result.error;
    } else {
      const result = await getAmazonItemNormalized(params.id);
      item = result.item;
      error = result.error;
    }

    const durationMs = Date.now() - startTime;

    if (!item || error) {
      console.log(`[ITEM_DETAILS_PROXY] ${params.source}_err`, JSON.stringify({
        error: error?.slice(0, 100) || "Item not found",
        durationMs,
      }));
      
      return new Response(
        JSON.stringify({ error: error || "Item not found" }),
        { status: 404, headers: CORS_HEADERS }
      );
    }

    console.log(`[ITEM_DETAILS_PROXY] ${params.source}_ok`, JSON.stringify({
      id: params.id.slice(0, 30),
      imageCount: item.imageUrls.length,
      durationMs,
    }));

    // 5. Cache the result
    await setCachedItem(supabase, cacheKey, params.source, item, cacheSettings.itemTtlSeconds);

    // 6. Build and return response
    const response = buildResponse(item, durationMs, false, false, 0, cacheSettings.itemTtlSeconds);
    return new Response(JSON.stringify(response), { headers: CORS_HEADERS });

  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error("[ITEM_DETAILS_PROXY] error", errorMsg);
    
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: CORS_HEADERS }
    );
  }
});

// ─── Request Parsing ─────────────────────────────────────────────────────────

function parseRequest(req: Request): ItemDetailsRequest | { error: string } {
  const url = new URL(req.url);
  const params = url.searchParams;

  // Required: source
  const source = params.get("source");
  if (!source || !["ebay", "amazon"].includes(source)) {
    return { error: "Missing or invalid source. Must be: ebay or amazon" };
  }

  // Required: id
  const id = params.get("id")?.trim();
  if (!id || id.length < 1) {
    return { error: "Missing required parameter: id" };
  }
  if (id.length > 100) {
    return { error: "ID too long (max 100 characters)" };
  }

  return {
    source: source as "ebay" | "amazon",
    id,
  };
}

// ─── Rate Limiting ───────────────────────────────────────────────────────────

interface RateLimitResult {
  allowed: boolean;
  remaining?: number;
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
  clientIp: string
): Promise<RateLimitResult> {
  try {
    const ipKey = `ip:${clientIp}:item-details`;
    const { data: ipResult, error: ipError } = await supabase.rpc("check_rate_limit", {
      p_key: ipKey,
      p_limit: RATE_LIMIT_IP,
      p_window_minutes: RATE_LIMIT_WINDOW_MINUTES,
    }) as { data: RateLimitRpcResult | null; error: Error | null };

    if (ipError) {
      console.error("[ITEM_DETAILS_PROXY] rate_limit_error", ipError.message);
      // Fail open on error
      return { allowed: true, key: ipKey };
    }

    if (!ipResult?.allowed) {
      return {
        allowed: false,
        retryAfter: ipResult?.reset_at,
        key: ipKey,
      };
    }

    return { 
      allowed: true, 
      remaining: ipResult.remaining,
      key: ipKey,
    };
  } catch (err) {
    console.error("[ITEM_DETAILS_PROXY] rate_limit_error", err);
    return { allowed: true };
  }
}

// ─── Caching with Stale-While-Revalidate ─────────────────────────────────────

async function getCacheWithAge(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  cacheKey: string,
  settings: ProxyCacheSettings
): Promise<CacheResultWithAge | null> {
  try {
    const { data, error } = await supabase
      .from("search_proxy_cache")
      .select("payload, expires_at, created_at")
      .eq("cache_key", cacheKey)
      .maybeSingle();
    
    if (error) {
      console.log("[ITEM_DETAILS_PROXY] cache_error", JSON.stringify({ 
        cacheKey: cacheKey.slice(0, 30), 
        error: error.message 
      }));
      return null;
    }
    
    if (!data) {
      return null;
    }
    
    const now = new Date();
    const createdAt = new Date(data.created_at);
    const expiresAt = new Date(data.expires_at);
    const ageSeconds = Math.floor((now.getTime() - createdAt.getTime()) / 1000);
    const isExpired = expiresAt <= now;
    
    // Check if cache is too old (beyond stale max)
    if (ageSeconds > settings.staleMaxSeconds) {
      console.log("[ITEM_DETAILS_PROXY] cache_too_old", JSON.stringify({ 
        cacheKey: cacheKey.slice(0, 30),
        ageSeconds,
        staleMaxSeconds: settings.staleMaxSeconds,
      }));
      return null;
    }
    
    return {
      payload: data.payload as CachedItemDetail,
      createdAt,
      expiresAt,
      ageSeconds,
      isExpired,
      isStale: isExpired,
    };
  } catch (err) {
    console.error("[ITEM_DETAILS_PROXY] cache_lookup_error", err);
    return null;
  }
}

async function setCachedItem(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  cacheKey: string,
  source: "ebay" | "amazon",
  item: NormalizedItemDetail,
  ttlSeconds: number
): Promise<void> {
  try {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + ttlSeconds * 1000);
    const payload: CachedItemDetail = {
      item,
      fetchedAt: now.toISOString(),
    };
    
    const { error } = await supabase
      .from("search_proxy_cache")
      .upsert({
        cache_key: cacheKey,
        source,
        payload,
        expires_at: expiresAt.toISOString(),
        created_at: now.toISOString(),
      }, { onConflict: "cache_key" });
    
    if (error) {
      console.error("[ITEM_DETAILS_PROXY] cache_write_error", JSON.stringify({
        cacheKey: cacheKey.slice(0, 30),
        error: error.message,
      }));
    }
  } catch (err) {
    console.error("[ITEM_DETAILS_PROXY] cache_set_error", err);
  }
}

/**
 * Trigger a background refresh for stale cache entries
 * This is fire-and-forget - we don't wait for it to complete
 */
function triggerBackgroundRefresh(
  supabase: SupabaseClient,
  source: "ebay" | "amazon",
  itemId: string,
  cacheKey: string,
  ttlSeconds: number
): void {
  // Execute refresh without blocking
  (async () => {
    try {
      const startTime = Date.now();
      let item: NormalizedItemDetail | null = null;
      let error: string | null = null;
      
      if (source === "ebay") {
        const result = await getEbayItemNormalized(supabase, itemId);
        item = result.item;
        error = result.error;
      } else {
        const result = await getAmazonItemNormalized(itemId);
        item = result.item;
        error = result.error;
      }
      
      const durationMs = Date.now() - startTime;
      
      if (item && !error) {
        await setCachedItem(supabase, cacheKey, source, item, ttlSeconds);
        
        console.log("[ITEM_DETAILS_PROXY] refresh_done", JSON.stringify({
          source,
          id: itemId.slice(0, 20),
          durationMs,
        }));
      } else {
        console.log("[ITEM_DETAILS_PROXY] refresh_failed", JSON.stringify({
          source,
          error: error?.slice(0, 100),
          durationMs,
        }));
      }
    } catch (err) {
      console.error("[ITEM_DETAILS_PROXY] refresh_error", err);
    }
  })();
}

// ─── Response Building ───────────────────────────────────────────────────────

function buildResponse(
  item: NormalizedItemDetail,
  durationMs: number,
  cacheHit: boolean,
  stale: boolean,
  ageSeconds: number,
  ttlSeconds: number
): ItemDetailsResponse {
  // Validate and limit imageUrls
  const validatedUrls = item.imageUrls
    .filter(url => url && url.startsWith("https://"))
    .slice(0, MAX_IMAGES);
  
  // Remove duplicates
  const dedupedUrls = [...new Set(validatedUrls)];

  return {
    source: item.source,
    externalId: item.externalId,
    title: item.title,
    price: item.price,
    currency: item.currency,
    imageUrl: dedupedUrls[0] || null,
    imageUrls: dedupedUrls,
    itemUrl: item.itemUrl,
    condition: item.condition,
    shippingPrice: item.shippingPrice,
    sellerName: item.sellerName,
    location: item.location,
    description: item.description,
    attributes: item.attributes,
    inStock: item.inStock,
    timingsMs: durationMs,
    cache: {
      hit: cacheHit,
      ttlSeconds,
      ...(cacheHit && { stale }),
      ...(cacheHit && ageSeconds > 0 && { ageSeconds }),
    },
  };
}
