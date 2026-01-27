/**
 * Catalog Search Endpoint
 * Search products via Rainforest API
 * GET /catalog-search?env=staging&q=iphone&page=1&pageSize=20&amazon_domain=amazon.com
 * 
 * IMPORTANT: This endpoint MUST always return 200 with stable JSON shape.
 * Mobile apps depend on this - never return 404.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { getEnvironmentFromRequest, getEnvironmentConfig, isCatalogEnabled } from "../_shared/environmentResolver.ts";
import { searchRainforest, formatCatalogItem } from "../_shared/rainforestAdapter.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-afrishop-environment",
  "Cache-Control": "public, max-age=60",
};

interface CatalogSearchResponse {
  status: "success" | "error";
  env: string;
  query: string;
  page: number;
  pageSize: number;
  total: number | null;
  items: any[];
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
  const query = url.searchParams.get("q") || "";
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));
  const pageSize = Math.min(50, Math.max(1, parseInt(url.searchParams.get("pageSize") || "20", 10)));
  const amazonDomain = url.searchParams.get("amazon_domain") || "amazon.com";
  
  // Detect environment from header or query param
  const envName = getEnvironmentFromRequest(req);

  console.log("[CATALOG_SEARCH]", JSON.stringify({
    q: query,
    page,
    pageSize,
    env: envName,
    domain: amazonDomain,
  }));

  // Default empty response for empty query
  if (!query.trim()) {
    return new Response(JSON.stringify({
      status: "success",
      env: envName,
      query: "",
      page,
      pageSize,
      total: 0,
      items: [],
      error: null,
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    
    if (!supabaseUrl || !supabaseKey) {
      console.warn("[CATALOG_SEARCH] Missing Supabase credentials");
      return new Response(JSON.stringify({
        status: "success",
        env: envName,
        query,
        page,
        pageSize,
        total: 0,
        items: [],
        error: null,
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(supabaseUrl, supabaseKey);
    const envConfig = await getEnvironmentConfig(supabase, envName);

    // If catalog is not enabled, return empty success (not error)
    if (!isCatalogEnabled(envConfig)) {
      console.log(`[CATALOG_SEARCH] Catalog not enabled for env=${envName}, returning empty`);
      return new Response(JSON.stringify({
        status: "success",
        env: envName,
        query,
        page,
        pageSize,
        total: 0,
        items: [],
        error: null,
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Search via Rainforest
    const { products, total, error: rainforestError } = await searchRainforest(
      query,
      page,
      pageSize,
      amazonDomain
    );

    // Format products for mobile
    const items = products.map(formatCatalogItem);

    // If Rainforest failed but we have no items, try cache
    if (rainforestError && items.length === 0) {
      // Search in cached products
      const { data: cachedProducts } = await supabase
        .from("catalog_products")
        .select("*")
        .gt("expires_at", new Date().toISOString())
        .ilike("title", `%${query}%`)
        .order("rating", { ascending: false })
        .limit(pageSize);

      if (cachedProducts && cachedProducts.length > 0) {
        const cachedItems = cachedProducts.map((p: any) => ({
          id: `rainforest:${p.provider_product_id}`,
          provider: "rainforest",
          providerProductId: p.provider_product_id,
          title: p.title || "",
          priceUsd: p.price_usd || null,
          imageUrl: p.image_url || null,
          productUrl: p.product_url || null,
          inStock: p.in_stock ?? null,
          rating: p.rating || null,
        }));

        console.log("[CATALOG_SEARCH]", JSON.stringify({
          q: query,
          page,
          env: envName,
          status: "success",
          source: "cache",
          itemCount: cachedItems.length,
          durationMs: Date.now() - startTime,
        }));

        return new Response(JSON.stringify({
          status: "success",
          env: envName,
          query,
          page,
          pageSize,
          total: cachedItems.length,
          items: cachedItems,
          error: null,
        }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // No cache, return error status but still 200
      console.log("[CATALOG_SEARCH]", JSON.stringify({
        q: query,
        page,
        env: envName,
        status: "error",
        error: rainforestError,
        durationMs: Date.now() - startTime,
      }));

      return new Response(JSON.stringify({
        status: "error",
        env: envName,
        query,
        page,
        pageSize,
        total: null,
        items: [],
        error: { code: "RAINFOREST_ERROR", message: "Search unavailable" },
      }), {
        status: 200, // Always 200
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log("[CATALOG_SEARCH]", JSON.stringify({
      q: query,
      page,
      env: envName,
      status: "success",
      itemCount: items.length,
      durationMs: Date.now() - startTime,
    }));

    return new Response(JSON.stringify({
      status: "success",
      env: envName,
      query,
      page,
      pageSize,
      total,
      items,
      error: null,
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "Unknown error";
    console.error("[CATALOG_SEARCH]", JSON.stringify({
      q: query,
      page,
      env: envName,
      status: "error",
      error: errorMessage,
      durationMs: Date.now() - startTime,
    }));
    
    // Even on error, return 200 with stable shape
    return new Response(JSON.stringify({
      status: "error",
      env: envName,
      query,
      page,
      pageSize,
      total: null,
      items: [],
      error: { code: "INTERNAL_ERROR", message: "Search service error" },
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
