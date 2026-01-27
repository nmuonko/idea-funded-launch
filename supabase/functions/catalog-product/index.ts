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
 * Parse product ID from query params
 * Supports:
 *   - id=rainforest:B0GCRKG9N1
 *   - provider=rainforest&asin=B0GCRKG9N1
 */
function parseProductId(url: URL): { provider: string | null; asin: string | null; rawId: string } {
  // Try combined id format first: "rainforest:B0GCRKG9N1"
  const id = url.searchParams.get("id") || "";
  if (id && id.includes(":")) {
    const [provider, asin] = id.split(":", 2);
    return { provider: provider || null, asin: asin || null, rawId: id };
  }

  // Try separate params
  const provider = url.searchParams.get("provider") || null;
  const asin = url.searchParams.get("asin") || null;
  const rawId = provider && asin ? `${provider}:${asin}` : asin || id || "";

  return { provider, asin, rawId };
}

Deno.serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  const url = new URL(req.url);
  const envName = getEnvironmentFromRequest(req);
  const amazonDomain = url.searchParams.get("amazon_domain") || "amazon.com";

  // Parse provider and asin from query
  const { provider, asin, rawId } = parseProductId(url);

  console.log("[CATALOG_PRODUCT]", JSON.stringify({
    env: envName,
    id: rawId,
    provider,
    asin,
  }));

  // Helper for consistent error responses
  const errorResponse = (code: string, message: string) => {
    console.log("[CATALOG_PRODUCT]", JSON.stringify({
      env: envName,
      id: rawId,
      status: "error",
      errorCode: code,
      durationMs: Date.now() - startTime,
    }));

    return new Response(JSON.stringify({
      status: "error",
      env: envName,
      id: rawId,
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
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  };

  // Validate we have an ASIN
  if (!asin?.trim()) {
    return errorResponse("MISSING_ASIN", "ASIN parameter is required. Use id=rainforest:ASIN or provider=rainforest&asin=ASIN");
  }

  // Validate provider (only rainforest supported for now)
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
      console.log("[CATALOG_PRODUCT]", JSON.stringify({
        env: envName,
        id: rawId,
        status: "success",
        source: "cache",
        durationMs: Date.now() - startTime,
      }));

      const rawData = cachedProduct.raw as Record<string, any> | null;
      const images = rawData?.images?.map((i: any) => i.link || i) || null;

      return new Response(JSON.stringify({
        status: "success",
        env: envName,
        id: `rainforest:${cachedProduct.provider_product_id}`,
        provider: "rainforest",
        providerProductId: cachedProduct.provider_product_id,
        title: cachedProduct.title || "",
        priceUsd: cachedProduct.price_usd || null,
        imageUrl: cachedProduct.image_url || null,
        productUrl: cachedProduct.product_url || null,
        inStock: cachedProduct.in_stock ?? null,
        rating: cachedProduct.rating || null,
        images: images,
        description: cachedProduct.description || null,
        raw: null, // Don't expose raw cache data
        item: {
          id: `rainforest:${cachedProduct.provider_product_id}`,
          provider: "rainforest",
          providerProductId: cachedProduct.provider_product_id,
          title: cachedProduct.title || "",
          priceUsd: cachedProduct.price_usd || null,
          imageUrl: cachedProduct.image_url || null,
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

    // Fetch from Rainforest
    const { product, error: rainforestError } = await fetchProductDetails(asin, amazonDomain);

    if (rainforestError || !product) {
      return errorResponse(rainforestError || "NOT_FOUND", "Product detail unavailable");
    }

    // Cache the product for future requests (fire and forget)
    const { data: providerRow } = await supabase
      .from("catalog_providers")
      .select("id")
      .eq("name", "amazon")
      .maybeSingle();

    if (providerRow?.id) {
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
          price_usd: product.priceUsd,
          currency: "USD",
          in_stock: product.inStock,
          rating: product.rating,
          review_count: product.reviewCount,
          brand: product.brand,
          category_path: product.categoryPath,
          raw: product.raw,
          expires_at: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString(),
        }, {
          onConflict: "provider_product_id",
        });
    }

    const formattedItem = formatCatalogItem(product);
    const rawData = product.raw as Record<string, any> | undefined;
    const images = rawData?.images?.map((i: any) => i.link || i) || null;

    console.log("[CATALOG_PRODUCT]", JSON.stringify({
      env: envName,
      id: rawId,
      status: "success",
      source: "rainforest",
      durationMs: Date.now() - startTime,
    }));

    return new Response(JSON.stringify({
      status: "success",
      env: envName,
      id: `rainforest:${product.providerProductId}`,
      provider: "rainforest",
      providerProductId: product.providerProductId,
      title: product.title || "",
      priceUsd: product.priceUsd,
      imageUrl: product.imageUrl,
      productUrl: product.productUrl,
      inStock: product.inStock,
      rating: product.rating,
      images: images,
      description: product.description || null,
      raw: null, // Optionally include trimmed raw if needed
      item: {
        ...formattedItem,
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
    console.error("[CATALOG_PRODUCT] Exception:", errorMessage);
    return errorResponse("INTERNAL_ERROR", "Product service error");
  }
});
