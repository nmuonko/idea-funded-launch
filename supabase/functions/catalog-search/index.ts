/**
 * Catalog Search Endpoint with Caching
 * Search products via Rainforest API with server-side cache
 * GET /catalog-search?env=staging&q=iphone&page=1&pageSize=20&amazon_domain=amazon.com&fast=1
 * 
 * Cache behavior:
 * - Fresh cache (<=30 min): return immediately
 * - Stale cache (>30 min): refresh then return (unless fast=1)
 * - fast=1: return stale cache immediately if available
 * 
 * IMPORTANT: This endpoint MUST always return 200 with stable JSON shape.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { getEnvironmentFromRequest, getEnvironmentConfig, isCatalogEnabled } from "../_shared/environmentResolver.ts";
import { searchRainforest, formatCatalogItem } from "../_shared/rainforestAdapter.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-afrishop-environment",
  "Cache-Control": "public, max-age=60",
};

// Cache TTL in seconds (30 minutes)
const CACHE_TTL_SECONDS = 30 * 60;

interface CacheRow {
  id: string;
  provider: string;
  query: string;
  page: number;
  page_size: number;
  amazon_domain: string;
  response: {
    items: any[];
    total: number | null;
  };
  updated_at: string;
}

interface CatalogSearchResponse {
  status: "success" | "error";
  env: string;
  query: string;
  page: number;
  pageSize: number;
  total: number | null;
  items: any[];
  cached: boolean;
  stale?: boolean;
  cacheAgeSec?: number;
  error: { code: string; message: string } | null;
}

function normalizeQuery(q: string): string {
  return q.trim().toLowerCase();
}

function getCacheAge(updatedAt: string): number {
  return Math.floor((Date.now() - new Date(updatedAt).getTime()) / 1000);
}

function isCacheFresh(updatedAt: string): boolean {
  return getCacheAge(updatedAt) <= CACHE_TTL_SECONDS;
}

Deno.serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();

  // Parse query params
  const url = new URL(req.url);
  const rawQuery = url.searchParams.get("q") || "";
  const query = normalizeQuery(rawQuery);
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));
  const pageSize = Math.min(50, Math.max(1, parseInt(url.searchParams.get("pageSize") || "20", 10)));
  const amazonDomain = url.searchParams.get("amazon_domain") || "amazon.com";
  const fastMode = url.searchParams.get("fast") === "1";
  
  // Detect environment from header or query param
  const envName = getEnvironmentFromRequest(req);

  console.log("[CATALOG_SEARCH]", JSON.stringify({
    q: query,
    page,
    pageSize,
    env: envName,
    domain: amazonDomain,
    fastMode,
  }));

  // Default empty response for empty query
  if (!query) {
    return new Response(JSON.stringify({
      status: "success",
      env: envName,
      query: "",
      page,
      pageSize,
      total: 0,
      items: [],
      cached: false,
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
        cached: false,
        error: null,
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(supabaseUrl, supabaseKey);
    const envConfig = await getEnvironmentConfig(supabase, envName);

    // If catalog is not enabled, return empty success
    if (!isCatalogEnabled(envConfig)) {
      console.log(`[CATALOG_SEARCH] Catalog not enabled for env=${envName}`);
      return new Response(JSON.stringify({
        status: "success",
        env: envName,
        query,
        page,
        pageSize,
        total: 0,
        items: [],
        cached: false,
        error: null,
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ========== CACHE LOOKUP ==========
    const { data: cacheRow } = await supabase
      .from("catalog_search_cache")
      .select("*")
      .eq("provider", "rainforest")
      .eq("query", query)
      .eq("page", page)
      .eq("page_size", pageSize)
      .eq("amazon_domain", amazonDomain)
      .maybeSingle();

    const typedCache = cacheRow as CacheRow | null;

    // If cache exists
    if (typedCache && typedCache.response?.items?.length > 0) {
      const cacheAgeSec = getCacheAge(typedCache.updated_at);
      const isFresh = isCacheFresh(typedCache.updated_at);
      
      // Fast mode: return stale immediately
      if (fastMode || isFresh) {
        console.log("[CATALOG_SEARCH]", JSON.stringify({
          q: query,
          page,
          env: envName,
          status: "success",
          source: isFresh ? "cache-fresh" : "cache-stale",
          cacheAgeSec,
          itemCount: typedCache.response.items.length,
          durationMs: Date.now() - startTime,
        }));

        return new Response(JSON.stringify({
          status: "success",
          env: envName,
          query,
          page,
          pageSize,
          total: typedCache.response.total,
          items: typedCache.response.items,
          cached: true,
          stale: !isFresh,
          cacheAgeSec,
          error: null,
        }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      
      // Stale cache, not fast mode: fetch fresh data
      console.log("[CATALOG_SEARCH] Cache stale, refreshing...");
    }

    // ========== FETCH FROM RAINFOREST ==========
    const { products, total, error: rainforestError } = await searchRainforest(
      query,
      page,
      pageSize,
      amazonDomain
    );

    // Format products for mobile
    const items = products.map(formatCatalogItem);

    // If Rainforest succeeded, update cache
    if (!rainforestError && items.length > 0) {
      const cacheData = {
        provider: "rainforest",
        query,
        page,
        page_size: pageSize,
        amazon_domain: amazonDomain,
        response: { items, total },
        updated_at: new Date().toISOString(),
      };

      // Upsert cache (use ON CONFLICT)
      const { error: upsertError } = await supabase
        .from("catalog_search_cache")
        .upsert(cacheData, {
          onConflict: "provider,query,page,page_size,amazon_domain",
        });

      if (upsertError) {
        console.warn("[CATALOG_SEARCH] Cache upsert failed:", upsertError.message);
      } else {
        console.log("[CATALOG_SEARCH] Cache updated for:", query);
      }

      console.log("[CATALOG_SEARCH]", JSON.stringify({
        q: query,
        page,
        env: envName,
        status: "success",
        source: "rainforest-live",
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
        cached: false,
        error: null,
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ========== FALLBACK: STALE CACHE OR CATALOG_PRODUCTS ==========
    
    // Try stale cache first
    if (typedCache && typedCache.response?.items?.length > 0) {
      const cacheAgeSec = getCacheAge(typedCache.updated_at);
      console.log("[CATALOG_SEARCH]", JSON.stringify({
        q: query,
        page,
        env: envName,
        status: "success",
        source: "cache-stale-fallback",
        cacheAgeSec,
        itemCount: typedCache.response.items.length,
        durationMs: Date.now() - startTime,
      }));

      return new Response(JSON.stringify({
        status: "success",
        env: envName,
        query,
        page,
        pageSize,
        total: typedCache.response.total,
        items: typedCache.response.items,
        cached: true,
        stale: true,
        cacheAgeSec,
        error: null,
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fallback to catalog_products table
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
        priceUsd: (p.price_usd && p.price_usd > 0) ? p.price_usd : null,
        imageUrl: p.image_url || null,
        images: p.raw?.images?.map((img: any) => img.link || img) || [],
        productUrl: p.product_url || null,
        inStock: p.in_stock ?? null,
        rating: p.rating || null,
      }));

      console.log("[CATALOG_SEARCH]", JSON.stringify({
        q: query,
        page,
        env: envName,
        status: "success",
        source: "catalog-products-fallback",
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
        cached: true,
        stale: true,
        error: null,
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // No cache available, return error status but still 200
    console.log("[CATALOG_SEARCH]", JSON.stringify({
      q: query,
      page,
      env: envName,
      status: "error",
      error: rainforestError || "No results",
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
      cached: false,
      error: { code: "RAINFOREST_ERROR", message: "Search unavailable" },
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
      cached: false,
      error: { code: "INTERNAL_ERROR", message: "Search service error" },
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
