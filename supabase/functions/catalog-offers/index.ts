// catalog-offers Edge Function
// Returns multiple sellers/offers for a product ASIN from Rainforest API
//
// Route: GET /functions/v1/catalog-offers?env=staging&asin=B0XXX
// Also accepts: id=rainforest:B0XXX
//
// Always returns HTTP 200 with stable JSON schema

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-afrishop-environment",
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
  error: { code: string; message: string } | null;
}

function extractPrice(priceObj: any): number | null {
  if (!priceObj) return null;
  
  // Try various price fields
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
  
  // Calculate total only if price is known
  let totalUsd: number | null = null;
  if (priceUsd !== null) {
    totalUsd = priceUsd + (shippingUsd ?? 0);
  }

  // Extract delivery info
  const deliveryRaw = rawOffer.delivery ?? {};
  const delivery = {
    minDays: deliveryRaw.min_days ?? null,
    maxDays: deliveryRaw.max_days ?? null,
    text: deliveryRaw.raw ?? deliveryRaw.tagline ?? null,
  };

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
    delivery,
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
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const url = new URL(req.url);
  const env = url.searchParams.get("env") ?? "production";
  const amazonDomain = url.searchParams.get("amazon_domain") ?? "amazon.com";
  
  // Parse ASIN from either 'asin' param or 'id' param (rainforest:ASIN format)
  let asin = url.searchParams.get("asin");
  const idParam = url.searchParams.get("id");
  
  if (!asin && idParam) {
    const parts = idParam.split(":");
    if (parts.length === 2 && parts[0] === "rainforest") {
      asin = parts[1];
    }
  }

  // Validate ASIN
  if (!asin || asin.length < 5) {
    console.info(`[CATALOG_OFFERS] ${JSON.stringify({ env, asin: asin ?? "missing", status: "error", reason: "invalid_asin" })}`);
    
    const errorResponse: OffersResponse = {
      status: "error",
      env,
      asin: asin ?? "",
      amazonDomain,
      buyBox: null,
      offers: [],
      offerCount: 0,
      error: { code: "INVALID_ASIN", message: "Valid ASIN required" },
    };
    
    return new Response(JSON.stringify(errorResponse), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  console.info(`[CATALOG_OFFERS] ${JSON.stringify({ env, asin, amazonDomain })}`);

  try {
    const apiKey = Deno.env.get("RAINFOREST_API_KEY");
    if (!apiKey) {
      throw new Error("RAINFOREST_API_KEY not configured");
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
      throw new Error(`Rainforest API error: ${response.status}`);
    }

    const data = await response.json();

    // Extract buybox
    const buyBox = normalizeBuyBox(data.buybox_winner ?? data.buybox);

    // Extract and normalize offers
    const rawOffers = data.offers ?? [];
    const offers: Offer[] = rawOffers.map((o: any) => normalizeOffer(o));

    console.info(`[CATALOG_OFFERS] ${JSON.stringify({ env, asin, status: "success", offerCount: offers.length })}`);

    const successResponse: OffersResponse = {
      status: "success",
      env,
      asin,
      amazonDomain,
      buyBox,
      offers,
      offerCount: offers.length,
      error: null,
    };

    return new Response(JSON.stringify(successResponse), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error(`[CATALOG_OFFERS] Error: ${message}`);

    const errorResponse: OffersResponse = {
      status: "error",
      env,
      asin,
      amazonDomain,
      buyBox: null,
      offers: [],
      offerCount: 0,
      error: { code: "RAINFOREST_ERROR", message: "Offers temporarily unavailable" },
    };

    return new Response(JSON.stringify(errorResponse), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
