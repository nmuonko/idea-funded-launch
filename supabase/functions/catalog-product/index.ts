/**
 * Catalog Product Details Endpoint - DB-First with Live Fallback
 * 
 * GET /catalog-product?id=rainforest:B0GCRKG9N1
 * GET /catalog-product?asin=B0GCRKG9N1
 * 
 * DB-First Strategy:
 * - First check catalog_items table (preloaded data)
 * - If not found, fetch from Rainforest and cache
 * 
 * IMPORTANT: This endpoint MUST always return 200 with stable JSON shape.
 * HARD BLOCK: Books, subscriptions, Prime Video are NEVER shown.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { getEnvironmentFromRequest, getEnvironmentConfig, isCatalogEnabled } from "../_shared/environmentResolver.ts";
import { fetchProductDetails, formatCatalogItem } from "../_shared/rainforestAdapter.ts";
import { getDeviceId } from "../_shared/catalogCache.ts";
import { isDisallowedItem, getBlockedSearchMessage } from "../_shared/contentBlocker.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-afrishop-environment, x-device-id",
  "Cache-Control": "public, max-age=300",
};

function validateAsin(asin: string): string | null {
  if (!asin || asin.length === 0) return "ASIN is required";
  if (asin.length !== 10) return `ASIN must be 10 characters (got ${asin.length})`;
  if (!/^[A-Z0-9]+$/.test(asin)) return "ASIN must be alphanumeric (A-Z, 0-9)";
  return null;
}

function parseProductId(url: URL): { provider: string | null; asin: string | null; rawId: string; asinError: string | null } {
  let provider: string | null = null;
  let asin: string | null = null;

  const id = (url.searchParams.get("id") || "").trim();
  if (id && id.includes(":")) {
    const parts = id.split(":", 2);
    provider = (parts[0] || "").trim().toLowerCase() || null;
    asin = (parts[1] || "").trim().toUpperCase() || null;
  } else {
    provider = (url.searchParams.get("provider") || "").trim().toLowerCase() || null;
    asin = (url.searchParams.get("asin") || "").trim().toUpperCase() || null;
    if (!asin && id) {
      asin = id.toUpperCase();
      provider = "rainforest";
    }
  }

  const rawId = provider && asin ? `${provider}:${asin}` : asin || id || "";
  const asinError = asin ? validateAsin(asin) : "ASIN is required";

  return { provider, asin, rawId, asinError };
}

interface CatalogItem {
  id: string;
  provider: string;
  providerProductId: string;
  title: string;
  priceUsd: number | null;
  imageUrl: string | null;
  images: string[];
  productUrl: string | null;
  inStock: boolean | null;
  rating: number | null;
  reviewCount?: number | null;
  description?: string | null;
  brand?: string | null;
  category?: string | null;
}

function mapDbItemToResponse(item: any): CatalogItem {
  return {
    id: item.id,
    provider: item.provider || "rainforest",
    providerProductId: item.provider_product_id,
    title: item.title || "",
    priceUsd: item.price_usd,
    imageUrl: item.image_url,
    images: item.images || [],
    productUrl: item.product_url,
    inStock: item.in_stock,
    rating: item.rating,
    reviewCount: item.review_count,
    description: item.raw?.description || null,
    brand: item.brand,
    category: item.category,
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  const url = new URL(req.url);
  const envName = getEnvironmentFromRequest(req);
  const amazonDomain = url.searchParams.get("amazon_domain") || "amazon.com";
  const deviceId = getDeviceId(req);

  const { provider, asin, rawId, asinError } = parseProductId(url);

  const errorResponse = (code: string, message: string) => {
    console.log(`[CATALOG_PRODUCT] asin=${asin || "MISSING"} error=${code} durationMs=${Date.now() - startTime}`);
    return new Response(JSON.stringify({
      status: "error",
      env: envName,
      id: rawId || null,
      item: null,
      source: "error",
      error: { code, message },
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  };

  if (asinError) return errorResponse("INVALID_ASIN", asinError);
  if (provider && provider !== "rainforest") return errorResponse("PROVIDER_NOT_SUPPORTED", `Provider '${provider}' not supported`);

  const productId = `rainforest:${asin}`;

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    
    if (!supabaseUrl || !supabaseKey) return errorResponse("CONFIG_ERROR", "Service unavailable");

    const supabase = createClient(supabaseUrl, supabaseKey);

    const envConfig = await getEnvironmentConfig(supabase, envName);
    if (!isCatalogEnabled(envConfig)) return errorResponse("CATALOG_DISABLED", "Catalog not enabled");

    // ========== DB-FIRST: Check catalog_items ==========
    const { data: dbItem } = await supabase
      .from("catalog_items")
      .select("*")
      .eq("id", productId)
      .maybeSingle();

    if (dbItem) {
      const item = mapDbItemToResponse(dbItem);
      
      // HARD BLOCK: Check if item is disallowed
      const blockCheck = isDisallowedItem({
        title: item.title,
        productUrl: item.productUrl,
        category: item.category,
      });
      
      if (blockCheck.isDisallowed) {
        console.log(`[CATALOG_PRODUCT] Blocked: asin=${asin} reason=${blockCheck.reason}`);
        return errorResponse("PRODUCT_NOT_AVAILABLE", getBlockedSearchMessage("en"));
      }
      
      console.log(`[CATALOG_PRODUCT] DB hit: asin=${asin} durationMs=${Date.now() - startTime}`);
      
      return new Response(JSON.stringify({
        status: "success",
        env: envName,
        id: productId,
        item,
        source: "db",
        cached: true,
        error: null,
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ========== FALLBACK: Check legacy catalog_products ==========
    const { data: legacyItem } = await supabase
      .from("catalog_products")
      .select("*")
      .eq("provider_product_id", asin)
      .gt("expires_at", new Date().toISOString())
      .maybeSingle();

    if (legacyItem) {
      const rawData = legacyItem.raw as Record<string, any> | null;
      let images: string[] = [];
      
      if (rawData?.processedImages && Array.isArray(rawData.processedImages)) {
        images = rawData.processedImages;
      } else if (rawData?.images && Array.isArray(rawData.images)) {
        images = rawData.images
          .map((i: any) => i?.large || i?.link || (typeof i === "string" ? i : null))
          .filter((url: any): url is string => !!url && url.startsWith("http"))
          .slice(0, 10);
      }
      
      if (legacyItem.image_url && !images.includes(legacyItem.image_url)) {
        images.unshift(legacyItem.image_url);
      }
      images = [...new Set(images)].slice(0, 10);

      const item: CatalogItem = {
        id: productId,
        provider: "rainforest",
        providerProductId: legacyItem.provider_product_id,
        title: legacyItem.title || "",
        priceUsd: legacyItem.price_usd > 0 ? legacyItem.price_usd : null,
        imageUrl: legacyItem.image_url || null,
        images,
        productUrl: legacyItem.product_url || null,
        inStock: legacyItem.in_stock ?? null,
        rating: legacyItem.rating || null,
        description: legacyItem.description || null,
        brand: legacyItem.brand || null,
      };

      console.log(`[CATALOG_PRODUCT] Legacy DB hit: asin=${asin} durationMs=${Date.now() - startTime}`);

      return new Response(JSON.stringify({
        status: "success",
        env: envName,
        id: productId,
        item,
        source: "db-legacy",
        cached: true,
        error: null,
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ========== LIVE FETCH: Rainforest API ==========
    const { product, error: rainforestError } = await fetchProductDetails(asin!, amazonDomain);

    if (rainforestError || !product) {
      return errorResponse(rainforestError || "NOT_FOUND", `Product not found on ${amazonDomain}`);
    }

    // HARD BLOCK: Check if live product is disallowed
    const liveBlockCheck = isDisallowedItem({
      title: product.title,
      productUrl: product.productUrl,
      categoryPath: product.categoryPath,
    });
    
    if (liveBlockCheck.isDisallowed) {
      console.log(`[CATALOG_PRODUCT] Blocked live: asin=${asin} reason=${liveBlockCheck.reason}`);
      return errorResponse("PRODUCT_NOT_AVAILABLE", getBlockedSearchMessage("en"));
    }

    // Cache to catalog_items
    const toCache = {
      id: productId,
      provider: "rainforest",
      provider_product_id: product.providerProductId,
      title: product.title,
      price_usd: product.priceUsd,
      image_url: product.imageUrl,
      images: product.images || [],
      product_url: product.productUrl,
      in_stock: product.inStock,
      rating: product.rating,
      review_count: product.reviewCount,
      brand: product.brand,
      category: "uncategorized",
      tags: [],
      raw: product.raw,
      updated_at: new Date().toISOString(),
    };

    await supabase.from("catalog_items").upsert(toCache, { onConflict: "id" });

    // Build response
    const item: CatalogItem = {
      id: productId,
      provider: "rainforest",
      providerProductId: product.providerProductId,
      title: product.title || "",
      priceUsd: product.priceUsd,
      imageUrl: product.imageUrl || null,
      images: (product.images || []).slice(0, 10),
      productUrl: product.productUrl || null,
      inStock: product.inStock ?? null,
      rating: product.rating ?? null,
      description: product.description || null,
      brand: product.brand || null,
    };

    console.log(`[CATALOG_PRODUCT] Live fetch: asin=${asin} durationMs=${Date.now() - startTime}`);

    return new Response(JSON.stringify({
      status: "success",
      env: envName,
      id: productId,
      item,
      source: "live",
      cached: false,
      error: null,
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "Unknown error";
    console.error(`[CATALOG_PRODUCT] Error: ${errorMessage} durationMs=${Date.now() - startTime}`);
    return errorResponse("INTERNAL_ERROR", "Product service error");
  }
});
