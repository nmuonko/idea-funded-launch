/**
 * Catalog Home Endpoint
 * Returns featured/trending content for the native catalog home screen
 * GET /catalog-home?env=staging&page=1&pageSize=20&amazon_domain=amazon.com
 * 
 * IMPORTANT: This endpoint MUST always return HTTP 200 with stable JSON shape.
 * Mobile apps depend on this - never return 404/500.
 * 
 * Response Schema (always HTTP 200):
 * {
 *   "status": "success" | "error",
 *   "env": "staging",
 *   "page": 1,
 *   "pageSize": 20,
 *   "trending": [...CatalogItem],
 *   "itemCount": <trending.length>,
 *   "hasMore": true | false,
 *   "error": null | "message"
 * }
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { getEnvironmentFromRequest, getEnvironmentConfig, isCatalogEnabled } from "../_shared/environmentResolver.ts";
import { fetchBestsellers, searchRainforest, formatCatalogItem } from "../_shared/rainforestAdapter.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-afrishop-environment",
  "Cache-Control": "public, max-age=300",
};

// Max page size allowed
const MAX_PAGE_SIZE = 40;
const DEFAULT_PAGE_SIZE = 20;
const DEFAULT_AMAZON_DOMAIN = "amazon.com";

interface CatalogHomeResponse {
  status: "success" | "error";
  env: string;
  page: number;
  pageSize: number;
  trending: any[];
  itemCount: number;
  hasMore: boolean;
  error: string | null;
}

/**
 * Build stable response - always returns this shape
 */
function buildResponse(
  status: "success" | "error",
  env: string,
  page: number,
  pageSize: number,
  trending: any[],
  hasMore: boolean,
  error: string | null
): CatalogHomeResponse {
  return {
    status,
    env,
    page,
    pageSize,
    trending,
    itemCount: trending.length,
    hasMore,
    error,
  };
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
  const rawPageSize = parseInt(url.searchParams.get("pageSize") || String(DEFAULT_PAGE_SIZE), 10);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, rawPageSize));
  const amazonDomain = url.searchParams.get("amazon_domain") || DEFAULT_AMAZON_DOMAIN;
  
  // Detect environment from header or query param
  const envName = getEnvironmentFromRequest(req);
  
  console.log("[CATALOG_HOME]", JSON.stringify({
    page,
    pageSize,
    amazonDomain,
    env: envName,
  }));

  // Default error response - always return this shape
  const errorResponse = (message: string) => 
    new Response(JSON.stringify(buildResponse("error", envName, page, pageSize, [], false, message)), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    
    if (!supabaseUrl || !supabaseKey) {
      console.warn("[CATALOG_HOME] Missing Supabase credentials");
      return errorResponse("Backend configuration error");
    }

    const supabase = createClient(supabaseUrl, supabaseKey);
    const envConfig = await getEnvironmentConfig(supabase, envName);

    // If catalog is not enabled, return error status with empty trending
    if (!isCatalogEnabled(envConfig)) {
      console.log(`[CATALOG_HOME] Catalog not enabled for env=${envName}`);
      return errorResponse("Catalog not enabled for this environment");
    }

    // Try fetching bestsellers from Rainforest
    let { products, total, hasMore: rainforestHasMore, error: rainforestError } = await fetchBestsellers(
      amazonDomain,
      page,
      pageSize
    );

    // Format products
    let trending = products.map(formatCatalogItem);
    
    // Use hasMore from Rainforest, or fallback to length check
    let hasMore = rainforestHasMore || trending.length >= pageSize;
    
    // FALLBACK 1: If bestsellers failed or returned empty, try search with trending terms
    if (trending.length === 0) {
      console.log("[CATALOG_HOME] Bestsellers empty, trying search fallback");
      
      // Use popular search terms for trending content
      const trendingQueries = ["electronics", "bestseller", "popular", "deals"];
      const searchQuery = trendingQueries[page % trendingQueries.length] || "electronics";
      
      const searchResult = await searchRainforest(
        searchQuery,
        page,
        pageSize,
        amazonDomain
      );
      
      if (!searchResult.error && searchResult.products.length > 0) {
        trending = searchResult.products.map(formatCatalogItem);
        hasMore = searchResult.hasMore;
        rainforestError = null; // Clear error since search worked
        console.log("[CATALOG_HOME] Search fallback successful", { itemCount: trending.length });
      }
    }
    
    // FALLBACK 2: If Rainforest still failed, try cache fallback
    if (rainforestError && trending.length === 0) {
      console.log("[CATALOG_HOME] Rainforest failed, trying cache fallback");
      
      // Calculate offset for pagination
      const offset = (page - 1) * pageSize;
      
      const { data: cachedProducts, count } = await supabase
        .from("catalog_products")
        .select("*", { count: "exact" })
        .gt("expires_at", new Date().toISOString())
        .order("rating", { ascending: false })
        .range(offset, offset + pageSize - 1);

      if (cachedProducts && cachedProducts.length > 0) {
        trending = cachedProducts.map((p: any) => ({
          id: `rainforest:${p.provider_product_id}`,
          provider: "rainforest",
          providerProductId: p.provider_product_id,
          title: p.title || "",
          priceUsd: (p.price_usd && p.price_usd > 0) ? p.price_usd : null,
          imageUrl: p.image_url || null,
          images: p.raw?.images?.map((img: any) => img.link || img) || (p.image_url ? [p.image_url] : []),
          productUrl: p.product_url || null,
          inStock: p.in_stock ?? null,
          rating: p.rating || null,
        }));
        
        // Calculate hasMore from cache count
        hasMore = count !== null ? (offset + trending.length) < count : false;
      }
    }

    // If still no products and all fallbacks failed, return error status
    if (trending.length === 0) {
      console.log("[CATALOG_HOME]", JSON.stringify({
        page,
        pageSize,
        env: envName,
        status: "error",
        error: rainforestError || "NO_PRODUCTS",
        durationMs: Date.now() - startTime,
      }));

      return errorResponse("Trending products temporarily unavailable");
    }

    // Log success
    console.log("[CATALOG_HOME]", JSON.stringify({
      page,
      pageSize,
      env: envName,
      status: "success",
      itemCount: trending.length,
      hasMore,
      durationMs: Date.now() - startTime,
    }));

    return new Response(JSON.stringify(buildResponse(
      "success",
      envName,
      page,
      pageSize,
      trending,
      hasMore,
      null
    )), {
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
    return errorResponse("Catalog service temporarily unavailable");
  }
});