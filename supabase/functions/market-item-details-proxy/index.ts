/**
 * Market Item Details Proxy Edge Function
 * Unified item details endpoint wrapping eBay and Amazon APIs
 * 
 * Features:
 * - Returns ALL item images (imageUrls array)
 * - Per-item caching with 5min TTL
 * - Rate limiting (60/5min per IP)
 * - Normalized response format
 * - Structured logging
 * 
 * Test examples:
 * - eBay item: /market-item-details-proxy?source=ebay&id=v1|123456|0
 * - Amazon item: /market-item-details-proxy?source=amazon&id=B09V3KXJPB
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import {
  getEbayItemNormalized,
  getAmazonItemNormalized,
  NormalizedItemDetail,
} from "../_shared/proxyProviders.ts";
import { getClientIp } from "../_shared/rateLimiter.ts";

// ─── Constants ───────────────────────────────────────────────────────────────

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Content-Type": "application/json",
};

const RATE_LIMIT_WINDOW_MINUTES = 5;
const RATE_LIMIT_IP = 60;
const CACHE_TTL_SECONDS = 300; // 5 minutes for item details
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
  };
}

interface CachedItemDetail {
  item: NormalizedItemDetail;
  fetchedAt: string;
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

    // 3. Check cache
    const cacheKey = `${params.source}:${params.id}`;
    const cached = await getCachedItem(supabase, cacheKey);
    
    if (cached) {
      console.log("[ITEM_DETAILS_PROXY] cache_hit", JSON.stringify({
        cacheKey: cacheKey.slice(0, 40),
      }));
      
      const response = buildResponse(cached.item, Date.now() - startTime, true);
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
    await setCachedItem(supabase, cacheKey, params.source, item);

    // 6. Build and return response
    const response = buildResponse(item, durationMs, false);
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

// ─── Caching ─────────────────────────────────────────────────────────────────

async function getCachedItem(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  cacheKey: string
): Promise<CachedItemDetail | null> {
  try {
    const { data, error } = await supabase
      .from("search_proxy_cache")
      .select("payload, expires_at")
      .eq("cache_key", `detail:${cacheKey}`)
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
    
    // Check expiration
    const expiresAt = new Date(data.expires_at);
    if (expiresAt <= new Date()) {
      return null;
    }
    
    return data.payload as CachedItemDetail;
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
  item: NormalizedItemDetail
): Promise<void> {
  try {
    const expiresAt = new Date(Date.now() + CACHE_TTL_SECONDS * 1000);
    const payload: CachedItemDetail = {
      item,
      fetchedAt: new Date().toISOString(),
    };
    
    const { error } = await supabase
      .from("search_proxy_cache")
      .upsert({
        cache_key: `detail:${cacheKey}`,
        source,
        payload,
        expires_at: expiresAt.toISOString(),
        created_at: new Date().toISOString(),
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

// ─── Response Building ───────────────────────────────────────────────────────

function buildResponse(
  item: NormalizedItemDetail,
  durationMs: number,
  cacheHit: boolean
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
      ttlSeconds: CACHE_TTL_SECONDS,
    },
  };
}
