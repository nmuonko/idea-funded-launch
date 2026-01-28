/**
 * Catalog Offers Endpoint with Smart Caching
 * Returns multiple sellers/offers for a product ASIN from Rainforest API
 * 
 * Cache strategy: stale=1hour, expire=6hours (prices change frequently)
 * 
 * GET /functions/v1/catalog-offers?env=staging&asin=B0XXX
 * Also accepts: id=rainforest:B0XXX
 * 
 * HARD BLOCK: Books, subscriptions, Prime Video are NEVER shown.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { getEnvironmentFromRequest } from "../_shared/environmentResolver.ts";
import { 
  buildCacheKey, 
  getCache, 
  setCache,
  checkRateLimit, 
  rateLimitResponse, 
  getDeviceId 
} from "../_shared/catalogCache.ts";
import { isDisallowedItem, getBlockedSearchMessage } from "../_shared/contentBlocker.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-afrishop-environment, x-device-id",
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

function extractPrice(priceObj: any): number | null {
  if (!priceObj) return null;
  const value = priceObj.value ?? priceObj.raw?.replace(/[^0-9.]/g, '');
  if (value !== undefined && value !== null && value !== '') {
    const parsed = typeof value === 'number' ? value : parseFloat(value);
    if (!isNaN(parsed) && parsed > 0) return parsed;
  }
  return null;
}

function normalizeOffer(rawOffer: any): Offer {
  const priceUsd = extractPrice(rawOffer.price);
  const shippingUsd = extractPrice(rawOffer.delivery_price) ?? extractPrice(rawOffer.shipping);
  let totalUsd: number | null = null;
  if (priceUsd !== null) totalUsd = priceUsd + (shippingUsd ?? 0);

  const deliveryRaw = rawOffer.delivery ?? {};
  return {
    sellerName: rawOffer.seller?.name ?? rawOffer.seller_name ?? null,
    priceUsd,
    shippingUsd,
    totalUsd,
    condition: rawOffer.condition?.is_new === false 
      ? (rawOffer.condition?.title ?? 'used') 
      : (rawOffer.condition?.is_new === true ? 'new' : (rawOffer.condition?.title ?? null)),
    isPrime: rawOffer.is_prime ?? null,
    isFba: rawOffer.is_fba ?? rawOffer.fulfilled_by_amazon ?? null,
    sellerRating: rawOffer.seller?.rating ?? null,
    sellerRatingsCount: rawOffer.seller?.ratings_total ?? rawOffer.seller?.num_ratings ?? null,
    delivery: {
      minDays: deliveryRaw.min_days ?? null,
      maxDays: deliveryRaw.max_days ?? null,
      text: deliveryRaw.raw ?? deliveryRaw.tagline ?? null,
    },
  };
}

function normalizeBuyBox(buyboxData: any): BuyBox | null {
  if (!buyboxData) return null;
  return {
    priceUsd: extractPrice(buyboxData.price) ?? extractPrice(buyboxData),
    seller: buyboxData.seller?.name ?? buyboxData.seller_name ?? null,
    shippingUsd: extractPrice(buyboxData.shipping) ?? extractPrice(buyboxData.delivery_price),
    condition: buyboxData.condition?.is_new === false ? 'used' : 'new',
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
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    
    if (!supabaseUrl || !supabaseKey) {
      return new Response(JSON.stringify(buildResponse("error", null, [], false, false, 0, { code: "CONFIG_ERROR", message: "Service unavailable" })), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    // Rate limiting
    const rateLimit = await checkRateLimit(supabase, deviceId, "offers");
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
    const cacheResult = await getCache(supabase, cacheKey);
    
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
      
      // UPGRADE A: Negative cache with short TTL (setCache auto-detects)
      await setCache(supabase, "offers", cacheKey, { buyBox: null, offers: [], error: "API_ERROR" }, { amazonDomain });
      
      return new Response(JSON.stringify(buildResponse("error", null, [], false, false, 0, { code: "RAINFOREST_ERROR", message: "Offers temporarily unavailable" })), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await response.json();
    const buyBox = normalizeBuyBox(data.buybox_winner ?? data.buybox);
    const offers: Offer[] = (data.offers ?? []).map((o: any) => normalizeOffer(o));

    // UPGRADE A & B: setCache handles both:
    // - Negative results (empty offers) get short TTL (1min stale, 5min expire)
    // - Positive results get normal TTL and normalized payload
    await setCache(supabase, "offers", cacheKey, { buyBox, offers }, { amazonDomain });

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
