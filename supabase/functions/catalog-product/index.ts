/**
 * Catalog Product Details Endpoint
 * Get product details by ASIN via Rainforest API
 * 
 * Supported query formats:
 *   GET /catalog-product?env=staging&id=rainforest:B0GCRKG9N1
 *   GET /catalog-product?env=staging&provider=rainforest&asin=B0GCRKG9N1
 * 
 * IMPORTANT: This endpoint MUST always return 200 with stable JSON shape.
 * Mobile apps depend on this - never return 404.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { getEnvironmentFromRequest, getEnvironmentConfig, isCatalogEnabled } from "../_shared/environmentResolver.ts";
import { fetchProductDetails, formatCatalogItem } from "../_shared/rainforestAdapter.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-afrishop-environment",
  "Cache-Control": "public, max-age=300",
};

/**
 * Validate ASIN format: 10 alphanumeric characters (Amazon standard)
 * Returns null if valid, error message if invalid
 */
function validateAsin(asin: string): string | null {
  if (!asin || asin.length === 0) {
    return "ASIN is required";
  }
  if (asin.length !== 10) {
    return `ASIN must be 10 characters (got ${asin.length})`;
  }
  if (!/^[A-Z0-9]+$/.test(asin)) {
    return "ASIN must be alphanumeric (A-Z, 0-9)";
  }
  return null;
}

/**
 * Parse product ID from query params
 * Supports:
 *   - id=rainforest:B0GCRKG9N1
 *   - provider=rainforest&asin=B0GCRKG9N1
 * 
 * Always normalizes ASIN: trim + uppercase
 */
function parseProductId(url: URL): { provider: string | null; asin: string | null; rawId: string; asinError: string | null } {
  let provider: string | null = null;
  let asin: string | null = null;

  // Try combined id format first: "rainforest:B0GCRKG9N1"
  const id = (url.searchParams.get("id") || "").trim();
  if (id && id.includes(":")) {
    const parts = id.split(":", 2);
    provider = (parts[0] || "").trim().toLowerCase() || null;
    asin = (parts[1] || "").trim().toUpperCase() || null;
  } else {
    // Try separate params
    provider = (url.searchParams.get("provider") || "").trim().toLowerCase() || null;
    asin = (url.searchParams.get("asin") || "").trim().toUpperCase() || null;
    
    // Fallback: if just id without colon, treat as ASIN
    if (!asin && id) {
      asin = id.toUpperCase();
      provider = "rainforest"; // default
    }
  }

  const rawId = provider && asin ? `${provider}:${asin}` : asin || id || "";
  
  // Validate ASIN format
  const asinError = asin ? validateAsin(asin) : "ASIN is required";

  return { provider, asin, rawId, asinError };
}

Deno.serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  const url = new URL(req.url);
  const envName = getEnvironmentFromRequest(req);
  // Force amazon.com unless explicitly passed
  const amazonDomain = url.searchParams.get("amazon_domain") || "amazon.com";

  // Parse provider and asin from query (with validation)
  const { provider, asin, rawId, asinError } = parseProductId(url);

  // Helper for consistent error responses with detailed logging
  const errorResponse = (code: string, message: string, httpStatus: number = 200, apiStatus: string = "error") => {
    console.log("[CATALOG_PRODUCT]", JSON.stringify({
      asin: asin || "MISSING",
      http: httpStatus,
      apiStatus,
      errorCode: code,
      env: envName,
      durationMs: Date.now() - startTime,
    }));

    return new Response(JSON.stringify({
      status: "error",
      env: envName,
      id: rawId || null,
      provider: provider || null,
      providerProductId: asin || null,
      title: null,
      priceUsd: null,
      imageUrl: null,
      productUrl: null,
      inStock: null,
      rating: null,
      images: null,
      description: null,
      raw: null,
      item: null,
      error: { code, message },
    }), {
      status: 200, // Always 200 for mobile stability
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  };

  // Log initial request
  console.log("[CATALOG_PRODUCT]", JSON.stringify({
    asin: asin || "MISSING",
    http: 200,
    apiStatus: "pending",
    env: envName,
    provider,
    amazonDomain,
  }));

  // Validate ASIN format (10 alphanumeric chars)
  if (asinError) {
    return errorResponse("INVALID_ASIN", asinError);
  }

  // Validate provider (only rainforest supported)
  if (provider && provider !== "rainforest") {
    return errorResponse("PROVIDER_NOT_SUPPORTED", `Provider '${provider}' not supported. Only 'rainforest' is supported.`);
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    
    if (!supabaseUrl || !supabaseKey) {
      console.warn("[CATALOG_PRODUCT] Missing Supabase credentials");
      return errorResponse("CONFIG_ERROR", "Service unavailable");
    }

    const supabase = createClient(supabaseUrl, supabaseKey);
    const envConfig = await getEnvironmentConfig(supabase, envName);

    // If catalog is not enabled, return error (not 404)
    if (!isCatalogEnabled(envConfig)) {
      console.log(`[CATALOG_PRODUCT] Catalog not enabled for env=${envName}`);
      return errorResponse("CATALOG_DISABLED", "Catalog not enabled for this environment");
    }

    // First check cache
    const { data: cachedProduct } = await supabase
      .from("catalog_products")
      .select("*")
      .eq("provider_product_id", asin)
      .gt("expires_at", new Date().toISOString())
      .maybeSingle();

    if (cachedProduct) {
      const rawData = cachedProduct.raw as Record<string, any> | null;
      
      // Extract images from raw data - check multiple sources
      let images: string[] = [];
      
      // Check if we stored processed images array
      if (rawData?.processedImages && Array.isArray(rawData.processedImages)) {
        images = rawData.processedImages;
      } else if (rawData?.images && Array.isArray(rawData.images)) {
        // Extract from raw Rainforest images array
        images = rawData.images
          .map((i: any) => {
            const url = i?.large || i?.link || (typeof i === "string" ? i : null);
            if (!url) return null;
            return url.startsWith("http") ? url : `https:${url}`;
          })
          .filter((url: any): url is string => !!url && url.startsWith("https://"))
          .slice(0, 10);
      }
      
      // Ensure primary image is first
      if (cachedProduct.image_url && !images.includes(cachedProduct.image_url)) {
        images.unshift(cachedProduct.image_url);
      }
      
      // Deduplicate
      images = [...new Set(images)].slice(0, 10);
      
      const priceUsd = (cachedProduct.price_usd && cachedProduct.price_usd > 0) ? cachedProduct.price_usd : null;

      console.log("[CATALOG_PRODUCT]", JSON.stringify({
        asin,
        http: 200,
        apiStatus: "success",
        source: "cache",
        hasPrice: priceUsd !== null,
        priceUsd,
        imageCount: images.length,
        durationMs: Date.now() - startTime,
      }));

      return new Response(JSON.stringify({
        status: "success",
        env: envName,
        id: `rainforest:${cachedProduct.provider_product_id}`,
        item: {
          id: `rainforest:${cachedProduct.provider_product_id}`,
          provider: "rainforest",
          providerProductId: cachedProduct.provider_product_id,
          title: cachedProduct.title || "",
          priceUsd,
          imageUrl: cachedProduct.image_url || null,
          images,
          productUrl: cachedProduct.product_url || null,
          inStock: cachedProduct.in_stock ?? null,
          rating: cachedProduct.rating || null,
          description: cachedProduct.description || null,
          brand: cachedProduct.brand || null,
        },
        error: null,
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch from Rainforest (always amazon.com unless explicit)
    const { product, error: rainforestError } = await fetchProductDetails(asin!, amazonDomain);

    if (rainforestError || !product) {
      return errorResponse(
        rainforestError || "NOT_FOUND", 
        `Product not found on ${amazonDomain}`,
        200,
        "error"
      );
    }

    // Cache the product for future requests (fire and forget)
    const { data: providerRow } = await supabase
      .from("catalog_providers")
      .select("id")
      .eq("name", "amazon")
      .maybeSingle();

    if (providerRow?.id) {
      // Ensure price is null (not 0) when unavailable
      const priceToCache = (product.priceUsd !== null && product.priceUsd > 0) 
        ? product.priceUsd 
        : null;
      
      // Store processed images array in raw for cache retrieval
      const rawWithImages = {
        ...(product.raw || {}),
        processedImages: product.images || [],
      };
      
      // Fire and forget - don't await
      supabase
        .from("catalog_products")
        .upsert({
          provider_id: providerRow.id,
          provider_product_id: product.providerProductId,
          title: product.title,
          description: product.description,
          image_url: product.imageUrl,
          product_url: product.productUrl,
          price_usd: priceToCache, // null, not 0, when unavailable
          currency: "USD",
          in_stock: product.inStock,
          rating: product.rating,
          review_count: product.reviewCount,
          brand: product.brand,
          category_path: product.categoryPath,
          raw: rawWithImages, // Include processedImages for cache
          expires_at: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString(),
        }, {
          onConflict: "provider_product_id",
        });
    }

    const images = product.images || [];
    const priceUsd = (product.priceUsd !== null && product.priceUsd > 0) ? product.priceUsd : null;

    console.log("[CATALOG_PRODUCT]", JSON.stringify({
      asin,
      http: 200,
      apiStatus: "success",
      source: "rainforest",
      hasPrice: priceUsd !== null,
      priceUsd,
      imageCount: images.length,
      durationMs: Date.now() - startTime,
    }));

    return new Response(JSON.stringify({
      status: "success",
      env: envName,
      id: `rainforest:${product.providerProductId}`,
      item: {
        id: `rainforest:${product.providerProductId}`,
        provider: "rainforest",
        providerProductId: product.providerProductId,
        title: product.title || "",
        priceUsd,
        imageUrl: product.imageUrl || null,
        images,
        productUrl: product.productUrl || null,
        inStock: product.inStock ?? null,
        rating: product.rating ?? null,
        description: product.description || null,
        brand: product.brand || null,
      },
      error: null,
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "Unknown error";
    console.error("[CATALOG_PRODUCT]", JSON.stringify({
      asin: asin || "UNKNOWN",
      http: 200,
      apiStatus: "error",
      errorCode: "INTERNAL_ERROR",
      error: errorMessage,
      durationMs: Date.now() - startTime,
    }));
    return errorResponse("INTERNAL_ERROR", "Product service error", 200, "error");
  }
});
