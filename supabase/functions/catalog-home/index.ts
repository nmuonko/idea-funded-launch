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
 *   "source": "bestsellers-electronics-mix" | "search-fallback" | "cache-fallback",
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

// Default electronics-focused category URLs
const DEFAULT_CATEGORY_URLS = [
  "https://www.amazon.com/Best-Sellers-Electronics/zgbs/electronics",
  "https://www.amazon.com/Best-Sellers-Cell-Phones-Accessories/zgbs/wireless",
  "https://www.amazon.com/Best-Sellers-Computers-Accessories/zgbs/pc",
  "https://www.amazon.com/Best-Sellers-Headphones/zgbs/electronics/12097479011",
];

// Default exclusion keywords to filter out books
const DEFAULT_EXCLUDE_KEYWORDS = {
  title_keywords: ["Kindle", "Audible", "Paperback", "Hardcover", "Audiobook", "Book Set", "Novel", "Edition", "Workbook"],
  url_patterns: ["/books/", "/Kindle/", "/Audible/"],
};

interface CatalogHomeResponse {
  status: "success" | "error";
  env: string;
  page: number;
  pageSize: number;
  trending: any[];
  itemCount: number;
  hasMore: boolean;
  source: string;
  error: string | null;
}

interface ExcludeConfig {
  title_keywords: string[];
  url_patterns: string[];
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
  source: string,
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
    source,
    error,
  };
}

/**
 * Check if a product should be excluded (e.g., books)
 */
function shouldExcludeProduct(product: any, excludeConfig: ExcludeConfig): boolean {
  const title = (product.title || "").toLowerCase();
  const productUrl = (product.productUrl || product.link || "").toLowerCase();
  
  // Check title keywords
  for (const keyword of excludeConfig.title_keywords) {
    if (title.includes(keyword.toLowerCase())) {
      return true;
    }
  }
  
  // Check URL patterns
  for (const pattern of excludeConfig.url_patterns) {
    if (productUrl.includes(pattern.toLowerCase())) {
      return true;
    }
  }
  
  return false;
}

/**
 * Fetch products from multiple category URLs in parallel
 */
async function fetchMultiCategoryProducts(
  categoryUrls: string[],
  amazonDomain: string,
  pageSize: number,
  excludeConfig: ExcludeConfig
): Promise<{ products: any[]; categoriesUsed: number; beforeFilter: number; afterFilter: number }> {
  const allProducts: any[] = [];
  const seenIds = new Set<string>();
  let categoriesUsed = 0;
  
  // Fetch from all categories in parallel
  const results = await Promise.allSettled(
    categoryUrls.map(url => 
      fetchBestsellers(amazonDomain, 1, 30, url) // Fetch 30 per category to have buffer after filtering
    )
  );
  
  for (const result of results) {
    if (result.status === "fulfilled" && !result.value.error && result.value.products.length > 0) {
      categoriesUsed++;
      for (const product of result.value.products) {
        const formatted = formatCatalogItem(product);
        // Dedupe by id
        if (!seenIds.has(formatted.id)) {
          seenIds.add(formatted.id);
          allProducts.push(formatted);
        }
      }
    }
  }
  
  const beforeFilter = allProducts.length;
  
  // Apply exclusion filter
  const filteredProducts = allProducts.filter(p => !shouldExcludeProduct(p, excludeConfig));
  
  const afterFilter = filteredProducts.length;
  
  return {
    products: filteredProducts.slice(0, pageSize),
    categoriesUsed,
    beforeFilter,
    afterFilter,
  };
}

/**
 * Load config from catalog_config table
 */
async function loadCatalogConfig(supabase: any): Promise<{
  categoryUrls: string[];
  excludeConfig: ExcludeConfig;
}> {
  try {
    const { data, error } = await supabase
      .from("catalog_config")
      .select("key, value")
      .in("key", ["home_category_urls", "home_exclude_keywords"]);
    
    if (error || !data) {
      console.log("[CATALOG_HOME] Using default config (no DB config found)");
      return {
        categoryUrls: DEFAULT_CATEGORY_URLS,
        excludeConfig: DEFAULT_EXCLUDE_KEYWORDS,
      };
    }
    
    let categoryUrls = DEFAULT_CATEGORY_URLS;
    let excludeConfig = DEFAULT_EXCLUDE_KEYWORDS;
    
    for (const row of data) {
      if (row.key === "home_category_urls" && Array.isArray(row.value)) {
        categoryUrls = row.value;
      } else if (row.key === "home_exclude_keywords" && row.value) {
        excludeConfig = {
          title_keywords: row.value.title_keywords || DEFAULT_EXCLUDE_KEYWORDS.title_keywords,
          url_patterns: row.value.url_patterns || DEFAULT_EXCLUDE_KEYWORDS.url_patterns,
        };
      }
    }
    
    return { categoryUrls, excludeConfig };
  } catch (err) {
    console.warn("[CATALOG_HOME] Error loading config:", err);
    return {
      categoryUrls: DEFAULT_CATEGORY_URLS,
      excludeConfig: DEFAULT_EXCLUDE_KEYWORDS,
    };
  }
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
  
  console.log("[CATALOG_HOME] Request", JSON.stringify({
    page,
    pageSize,
    amazonDomain,
    env: envName,
  }));

  // Default error response - always return this shape
  const errorResponse = (message: string, source: string = "error") => 
    new Response(JSON.stringify(buildResponse("error", envName, page, pageSize, [], false, source, message)), {
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

    // Load category URLs and exclusion config from DB
    const { categoryUrls, excludeConfig } = await loadCatalogConfig(supabase);
    
    let trending: any[] = [];
    let hasMore = false;
    let source = "bestsellers-electronics-mix";
    
    // For page 1, fetch from multiple electronics categories
    if (page === 1) {
      const result = await fetchMultiCategoryProducts(
        categoryUrls,
        amazonDomain,
        pageSize,
        excludeConfig
      );
      
      trending = result.products;
      hasMore = trending.length >= pageSize;
      
      console.log("[CATALOG_HOME] categoriesUsed=" + result.categoriesUsed + 
                  " beforeFilter=" + result.beforeFilter + 
                  " afterFilter=" + result.afterFilter + 
                  " returned=" + trending.length);
      
      // If multi-category fetch worked
      if (trending.length > 0) {
        source = "bestsellers-electronics-mix";
      }
    }
    
    // FALLBACK 1: If page > 1 or multi-category failed, try search with electronics terms
    if (trending.length === 0) {
      console.log("[CATALOG_HOME] Using search fallback");
      
      const electronicsQueries = ["electronics", "phone", "laptop", "headphones", "tablet"];
      const searchQuery = electronicsQueries[(page - 1) % electronicsQueries.length] || "electronics";
      
      const searchResult = await searchRainforest(
        searchQuery,
        page,
        pageSize,
        amazonDomain
      );
      
      if (!searchResult.error && searchResult.products.length > 0) {
        // Apply exclusion filter to search results
        const filtered = searchResult.products
          .map(formatCatalogItem)
          .filter(p => !shouldExcludeProduct(p, excludeConfig));
        
        trending = filtered.slice(0, pageSize);
        hasMore = searchResult.hasMore;
        source = "search-fallback";
        console.log("[CATALOG_HOME] Search fallback successful", { 
          query: searchQuery, 
          beforeFilter: searchResult.products.length,
          afterFilter: trending.length 
        });
      }
    }
    
    // FALLBACK 2: If search also failed, try cache
    if (trending.length === 0) {
      console.log("[CATALOG_HOME] Using cache fallback");
      
      const offset = (page - 1) * pageSize;
      
      const { data: cachedProducts, count } = await supabase
        .from("catalog_products")
        .select("*", { count: "exact" })
        .gt("expires_at", new Date().toISOString())
        .order("rating", { ascending: false })
        .range(offset, offset + pageSize - 1);

      if (cachedProducts && cachedProducts.length > 0) {
        const formatted = cachedProducts.map((p: any) => ({
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
        
        // Apply exclusion filter
        trending = formatted.filter((p: any) => !shouldExcludeProduct(p, excludeConfig));
        hasMore = count !== null ? (offset + trending.length) < count : false;
        source = "cache-fallback";
      }
    }

    // If still no products and all fallbacks failed, return error status
    if (trending.length === 0) {
      console.log("[CATALOG_HOME]", JSON.stringify({
        page,
        pageSize,
        env: envName,
        status: "error",
        error: "NO_PRODUCTS",
        durationMs: Date.now() - startTime,
      }));

      return errorResponse("Trending products temporarily unavailable", "no-products");
    }

    // Log success
    console.log("[CATALOG_HOME]", JSON.stringify({
      page,
      pageSize,
      env: envName,
      status: "success",
      itemCount: trending.length,
      hasMore,
      source,
      durationMs: Date.now() - startTime,
    }));

    return new Response(JSON.stringify(buildResponse(
      "success",
      envName,
      page,
      pageSize,
      trending,
      hasMore,
      source,
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