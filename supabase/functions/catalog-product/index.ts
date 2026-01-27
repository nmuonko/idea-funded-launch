/**
 * Catalog Product Details Endpoint
 * Get product details by ASIN via Rainforest API
 * GET /catalog-product?env=staging&asin=B000YDDF6O&amazon_domain=amazon.com
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

interface CatalogProductResponse {
  status: "success" | "error";
  env: string;
  item: {
    id: string;
    provider: string;
    providerProductId: string;
    title: string;
    priceUsd: number | null;
    imageUrl: string | null;
    productUrl: string | null;
    inStock: boolean | null;
    rating: number | null;
    description?: string;
    images?: string[];
    brand?: string;
  } | null;
  error: { code: string; message: string } | null;
}

Deno.serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();

  // Parse query params
  const url = new URL(req.url);
  const asin = url.searchParams.get("asin") || url.searchParams.get("id") || "";
  const amazonDomain = url.searchParams.get("amazon_domain") || "amazon.com";
  
  // Detect environment from header or query param
  const envName = getEnvironmentFromRequest(req);

  console.log("[CATALOG_PRODUCT]", JSON.stringify({
    asin,
    env: envName,
    domain: amazonDomain,
  }));

  // Empty ASIN
  if (!asin.trim()) {
    return new Response(JSON.stringify({
      status: "error",
      env: envName,
      item: null,
      error: { code: "MISSING_ASIN", message: "ASIN parameter is required" },
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    
    if (!supabaseUrl || !supabaseKey) {
      console.warn("[CATALOG_PRODUCT] Missing Supabase credentials");
      return new Response(JSON.stringify({
        status: "error",
        env: envName,
        item: null,
        error: { code: "CONFIG_ERROR", message: "Service unavailable" },
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(supabaseUrl, supabaseKey);
    const envConfig = await getEnvironmentConfig(supabase, envName);

    // If catalog is not enabled, return empty success
    if (!isCatalogEnabled(envConfig)) {
      console.log(`[CATALOG_PRODUCT] Catalog not enabled for env=${envName}`);
      return new Response(JSON.stringify({
        status: "error",
        env: envName,
        item: null,
        error: { code: "CATALOG_DISABLED", message: "Catalog not enabled" },
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
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
        asin,
        env: envName,
        status: "success",
        source: "cache",
        durationMs: Date.now() - startTime,
      }));

      return new Response(JSON.stringify({
        status: "success",
        env: envName,
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
          description: cachedProduct.description || undefined,
          brand: cachedProduct.brand || undefined,
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
      console.log("[CATALOG_PRODUCT]", JSON.stringify({
        asin,
        env: envName,
        status: "error",
        error: rainforestError || "NOT_FOUND",
        durationMs: Date.now() - startTime,
      }));

      return new Response(JSON.stringify({
        status: "error",
        env: envName,
        item: null,
        error: { code: rainforestError || "NOT_FOUND", message: "Product not found" },
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Cache the product for future requests (fire and forget)
    const { data: provider } = await supabase
      .from("catalog_providers")
      .select("id")
      .eq("name", "amazon")
      .maybeSingle();

    if (provider?.id) {
      // Fire and forget - don't await
      supabase
        .from("catalog_products")
        .upsert({
          provider_id: provider.id,
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
          expires_at: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString(),
        }, {
          onConflict: "provider_product_id",
        });
    }

    const formattedItem = formatCatalogItem(product);
    const rawImages = product.raw as Record<string, any> | undefined;

    console.log("[CATALOG_PRODUCT]", JSON.stringify({
      asin,
      env: envName,
      status: "success",
      source: "rainforest",
      durationMs: Date.now() - startTime,
    }));

    return new Response(JSON.stringify({
      status: "success",
      env: envName,
      item: {
        ...formattedItem,
        description: product.description || undefined,
        brand: product.brand || undefined,
        images: rawImages?.images?.map((i: any) => i.link) || undefined,
      },
      error: null,
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "Unknown error";
    console.error("[CATALOG_PRODUCT]", JSON.stringify({
      asin,
      env: envName,
      status: "error",
      error: errorMessage,
      durationMs: Date.now() - startTime,
    }));
    
    return new Response(JSON.stringify({
      status: "error",
      env: envName,
      item: null,
      error: { code: "INTERNAL_ERROR", message: "Product service error" },
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
