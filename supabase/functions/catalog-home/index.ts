/**
 * Catalog Home Endpoint
 * Returns featured/trending content for the native catalog home screen
 * GET /catalog-home?env=staging&page=1&pageSize=20
 * 
 * IMPORTANT: This endpoint MUST always return 200 with stable JSON shape.
 * Mobile apps depend on this - never return 404.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { getEnvironmentFromRequest, getEnvironmentConfig, isCatalogEnabled } from "../_shared/environmentResolver.ts";
import { fetchBestsellers, formatCatalogItem } from "../_shared/rainforestAdapter.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-afrishop-environment",
  "Cache-Control": "public, max-age=300",
};

interface CatalogHomeResponse {
  status: "success" | "error";
  env: string;
  featured: any[];
  categories: any[];
  trending: any[];
  itemCount: number;
  page: number;
  pageSize: number;
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
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));
  const pageSize = Math.min(50, Math.max(1, parseInt(url.searchParams.get("pageSize") || "20", 10)));
  
  // Detect environment from header or query param
  const envName = getEnvironmentFromRequest(req);
  
  console.log("[CATALOG_HOME]", JSON.stringify({
    page,
    pageSize,
    env: envName,
  }));

  // Default response - always return this shape
  const defaultResponse: CatalogHomeResponse = {
    status: "success",
    env: envName,
    featured: [],
    categories: [],
    trending: [],
    itemCount: 0,
    page,
    pageSize,
    error: null,
  };

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    
    if (!supabaseUrl || !supabaseKey) {
      console.warn("[CATALOG_HOME] Missing Supabase credentials");
      return new Response(JSON.stringify(defaultResponse), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(supabaseUrl, supabaseKey);
    const envConfig = await getEnvironmentConfig(supabase, envName);

    // If catalog is not enabled, return empty success (not error)
    if (!isCatalogEnabled(envConfig)) {
      console.log(`[CATALOG_HOME] Catalog not enabled for env=${envName}, returning empty`);
      return new Response(JSON.stringify(defaultResponse), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const amazonDomain = "amazon.com";

    // Fetch trending products from Rainforest (using amazon_domain, not URL)
    // Don't pass bestsellersUrl to avoid the amazon_domain+url conflict error
    const { products, total, error: rainforestError } = await fetchBestsellers(
      amazonDomain,
      page,
      pageSize
      // No bestsellersUrl - let Rainforest use amazon_domain
    );

    // Get categories from DB
    const { data: categories } = await supabase
      .from("catalog_categories")
      .select("id, name, icon_url")
      .eq("enabled", true)
      .order("priority", { ascending: false })
      .limit(10);

    // If Rainforest failed, try to return cached products
    let trending = products.map(formatCatalogItem);
    
    if (rainforestError && trending.length === 0) {
      // Try cache fallback
      const { data: cachedProducts } = await supabase
        .from("catalog_products")
        .select("*")
        .gt("expires_at", new Date().toISOString())
        .order("rating", { ascending: false })
        .limit(pageSize);

      if (cachedProducts && cachedProducts.length > 0) {
        trending = cachedProducts.map((p: any) => ({
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
      }
    }

    // If still no products and Rainforest failed, return error status
    if (rainforestError && trending.length === 0) {
      console.log("[CATALOG_HOME]", JSON.stringify({
        page,
        pageSize,
        env: envName,
        status: "error",
        error: rainforestError,
        durationMs: Date.now() - startTime,
      }));

      return new Response(JSON.stringify({
        status: "error",
        env: envName,
        featured: [],
        categories: (categories || []).map((c: any) => ({
          id: c.id,
          name: c.name,
          icon: c.icon_url,
        })),
        trending: [],
        itemCount: 0,
        page,
        pageSize,
        error: { code: "RAINFOREST_ERROR", message: "Trending unavailable" },
      }), {
        status: 200, // Always 200
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log("[CATALOG_HOME]", JSON.stringify({
      page,
      pageSize,
      env: envName,
      status: "success",
      itemCount: trending.length,
      durationMs: Date.now() - startTime,
    }));

    return new Response(JSON.stringify({
      status: "success",
      env: envName,
      featured: [], // Future: featured collections
      categories: (categories || []).map((c: any) => ({
        id: c.id,
        name: c.name,
        icon: c.icon_url,
      })),
      trending,
      itemCount: trending.length,
      page,
      pageSize,
      error: null,
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "Unknown error";
    console.error("[CATALOG_HOME]", JSON.stringify({
      page,
      pageSize,
      env: envName,
      status: "error",
      error: errorMessage,
      durationMs: Date.now() - startTime,
    }));
    
    // Even on error, return 200 with stable shape
    return new Response(JSON.stringify({
      status: "error",
      env: envName,
      featured: [],
      categories: [],
      trending: [],
      itemCount: 0,
      page,
      pageSize,
      error: { code: "INTERNAL_ERROR", message: "Catalog service error" },
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
