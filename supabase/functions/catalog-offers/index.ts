/**
 * Catalog Offers Endpoint with Smart Caching
 * Returns multiple sellers/offers for a product ASIN from Rainforest API
 * 
 * SDK-FREE: Uses lightweight PostgREST client to avoid bundler timeouts
 * 
 * Cache strategy: stale=1hour, expire=6hours (prices change frequently)
 * 
 * GET /functions/v1/catalog-offers?env=staging&asin=B0XXX
 * Also accepts: id=rainforest:B0XXX
 * 
 * HARD BLOCK: Books, subscriptions, Prime Video are NEVER shown.
 */

import { createAdminPostgrestClient } from "../_shared/postgrest.ts";
import { getEnvironmentFromRequest } from "../_shared/environmentResolver.ts";
import { 
  buildCacheKey, 
  getCache, 
  setCache,
  checkRateLimit, 
  rateLimitResponse, 
  getDeviceId 
} from "../_shared/catalogCache.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-afrishop-environment, x-device-id, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

interface Offer {
  sellerName: string | null;
  priceUsd: number | null;
  shippingUsd: number | null;
  totalUsd: number | null;
  condition: string | null;
  isPrime: boolean | null;
  isFba: boolean | null;
  sellerRating: number | null;
  sellerRatingsCount: number | null;
  delivery: {
    minDays: number | null;
    maxDays: number | null;
    text: string | null;
  };
}

interface BuyBox {
  priceUsd: number | null;
  seller: string | null;
  shippingUsd: number | null;
  condition: string | null;
}

interface OffersResponse {
  status: "success" | "error";
  env: string;
  asin: string;
  amazonDomain: string;
  buyBox: BuyBox | null;
  offers: Offer[];
  offerCount: number;
  cached: boolean;
  stale: boolean;
  cacheAgeSec: number;
  error: { code: string; message: string } | null;
}

function extractPrice(priceObj: unknown): number | null {
  if (!priceObj) return null;
  const obj = priceObj as Record<string, unknown>;
  const value = obj.value ?? (obj.raw as string)?.replace(/[^0-9.]/g, '');
  if (value !== undefined && value !== null && value !== '') {
    const parsed = typeof value === 'number' ? value : parseFloat(value as string);
    if (!isNaN(parsed) && parsed > 0) return parsed;
  }
  return null;
}

function normalizeOffer(rawOffer: Record<string, unknown>): Offer {
  const priceUsd = extractPrice(rawOffer.price);
  const shippingUsd = extractPrice(rawOffer.delivery_price) ?? extractPrice(rawOffer.shipping);
  let totalUsd: number | null = null;
  if (priceUsd !== null) totalUsd = priceUsd + (shippingUsd ?? 0);

  const deliveryRaw = (rawOffer.delivery ?? {}) as Record<string, unknown>;
  const sellerObj = rawOffer.seller as Record<string, unknown> | undefined;
  const conditionObj = rawOffer.condition as Record<string, unknown> | undefined;
  
  return {
    sellerName: sellerObj?.name as string ?? rawOffer.seller_name as string ?? null,
    priceUsd,
    shippingUsd,
    totalUsd,
    condition: conditionObj?.is_new === false 
      ? (conditionObj?.title as string ?? 'used') 
      : (conditionObj?.is_new === true ? 'new' : (conditionObj?.title as string ?? null)),
    isPrime: rawOffer.is_prime as boolean ?? null,
    isFba: rawOffer.is_fba as boolean ?? rawOffer.fulfilled_by_amazon as boolean ?? null,
    sellerRating: sellerObj?.rating as number ?? null,
    sellerRatingsCount: sellerObj?.ratings_total as number ?? sellerObj?.num_ratings as number ?? null,
    delivery: {
      minDays: deliveryRaw.min_days as number ?? null,
      maxDays: deliveryRaw.max_days as number ?? null,
      text: deliveryRaw.raw as string ?? deliveryRaw.tagline as string ?? null,
    },
  };
}

function normalizeBuyBox(buyboxData: unknown): BuyBox | null {
  if (!buyboxData) return null;
  const data = buyboxData as Record<string, unknown>;
  const sellerObj = data.seller as Record<string, unknown> | undefined;
  const conditionObj = data.condition as Record<string, unknown> | undefined;
  
  return {
    priceUsd: extractPrice(data.price) ?? extractPrice(data),
    seller: sellerObj?.name as string ?? data.seller_name as string ?? null,
    shippingUsd: extractPrice(data.shipping) ?? extractPrice(data.delivery_price),
    condition: conditionObj?.is_new === false ? 'used' : 'new',
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const startTime = Date.now();
  const url = new URL(req.url);
  const envName = getEnvironmentFromRequest(req);
  const amazonDomain = url.searchParams.get("amazon_domain") ?? "amazon.com";
  const deviceId = getDeviceId(req);
  const isStaging = envName === "staging";
  
  // Parse ASIN
  let asin = url.searchParams.get("asin");
  const idParam = url.searchParams.get("id");
  if (!asin && idParam) {
    const parts = idParam.split(":");
    if (parts.length === 2 && parts[0] === "rainforest") asin = parts[1];
  }

  const buildResponse = (
    status: "success" | "error", 
    buyBox: BuyBox | null, 
    offers: Offer[], 
    cached: boolean, 
    stale: boolean, 
    cacheAgeSec: number,
    error: { code: string; message: string } | null
  ): OffersResponse => ({
    status,
    env: envName,
    asin: asin ?? "",
    amazonDomain,
    buyBox,
    offers,
    offerCount: offers.length,
    cached,
    stale,
    cacheAgeSec,
    error,
  });

  if (!asin || asin.length < 5) {
    console.info(`[CATALOG_OFFERS] Invalid ASIN: ${asin ?? "missing"}`);
    return new Response(JSON.stringify(buildResponse("error", null, [], false, false, 0, { code: "INVALID_ASIN", message: "Valid ASIN required" })), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    // Use SDK-free PostgREST client
    const db = createAdminPostgrestClient();

    // Rate limiting
    const rateLimit = await checkRateLimit(db, deviceId, "offers");
    if (!rateLimit.allowed) {
      console.log(`[CATALOG_OFFERS] Rate limited device=${deviceId} count=${rateLimit.count}`);
      return new Response(JSON.stringify(rateLimitResponse(rateLimit.resetAt)), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Build cache key
    const productId = `rainforest:${asin}`;
    const cacheKey = buildCacheKey("offers", {
      env: envName,
      domain: amazonDomain,
      productId,
    });

    // Check cache first
    const cacheResult = await getCache(db, cacheKey);
    
    if (cacheResult.hit && cacheResult.data) {
      console.log(`[CATALOG_OFFERS] Cache hit: asin=${asin} stale=${cacheResult.stale} age=${cacheResult.cacheAgeSec}s`);
      
      return new Response(JSON.stringify({
        ...buildResponse(
          "success",
          cacheResult.data.buyBox,
          cacheResult.data.offers || [],
          true,
          cacheResult.stale,
          cacheResult.cacheAgeSec,
          null
        ),
        ...(isStaging && { cacheKey }),
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.info(`[CATALOG_OFFERS] Cache miss: asin=${asin}, fetching from Rainforest`);

    const apiKey = Deno.env.get("RAINFOREST_API_KEY");
    if (!apiKey) {
      return new Response(JSON.stringify(buildResponse("error", null, [], false, false, 0, { code: "CONFIG_ERROR", message: "API not configured" })), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Call Rainforest offers endpoint
    const rainforestUrl = new URL("https://api.rainforestapi.com/request");
    rainforestUrl.searchParams.set("api_key", apiKey);
    rainforestUrl.searchParams.set("type", "offers");
    rainforestUrl.searchParams.set("asin", asin);
    rainforestUrl.searchParams.set("amazon_domain", amazonDomain);

    const response = await fetch(rainforestUrl.toString(), {
      method: "GET",
      headers: { "Accept": "application/json" },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[CATALOG_OFFERS] Rainforest error: ${response.status} - ${errorText.substring(0, 200)}`);
      
      // Negative cache with short TTL
      await setCache(db, "offers", cacheKey, { buyBox: null, offers: [], error: "API_ERROR" }, { amazonDomain });
      
      return new Response(JSON.stringify(buildResponse("error", null, [], false, false, 0, { code: "RAINFOREST_ERROR", message: "Offers temporarily unavailable" })), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await response.json();
    const buyBox = normalizeBuyBox(data.buybox_winner ?? data.buybox);
    const offers: Offer[] = ((data.offers ?? []) as Record<string, unknown>[]).map(normalizeOffer);

    await setCache(db, "offers", cacheKey, { buyBox, offers }, { amazonDomain });

    console.info(`[CATALOG_OFFERS] Rainforest fetch: asin=${asin} offerCount=${offers.length} durationMs=${Date.now() - startTime}`);

    return new Response(JSON.stringify(buildResponse("success", buyBox, offers, false, false, 0, null)), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error(`[CATALOG_OFFERS] Error: ${message}`);

    return new Response(JSON.stringify(buildResponse("error", null, [], false, false, 0, { code: "INTERNAL_ERROR", message: "Offers service error" })), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
