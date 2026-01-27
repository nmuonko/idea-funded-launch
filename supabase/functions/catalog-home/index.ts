/**
 * Catalog Home Endpoint
 * Returns featured/trending content for the native catalog home screen
 * GET /catalog-home?env=staging&page=1&pageSize=20&category=phones&amazon_domain=amazon.com
 * 
 * IMPORTANT: This endpoint MUST always return HTTP 200 with stable JSON shape.
 * Mobile apps depend on this - never return 404/500.
 * 
 * Response Schema (always HTTP 200):
 * {
 *   "status": "success" | "error",
 *   "env": "staging",
 *   "category": "phones" | "computers" | "audio" | "monitors" | "all",
 *   "page": 1,
 *   "pageSize": 20,
 *   "trending": [...CatalogItem],
 *   "itemCount": <trending.length>,
 *   "hasMore": true | false,
 *   "source": "bestsellers-category" | "cache-fallback",
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

// Category-specific Amazon Best Sellers URLs
const CATEGORY_URLS: Record<string, string> = {
  all: "https://www.amazon.com/Best-Sellers/zgbs",
  phones: "https://www.amazon.com/Best-Sellers-Cell-Phones-Accessories/zgbs/wireless",
  computers: "https://www.amazon.com/Best-Sellers-Computers-Accessories/zgbs/pc",
  audio: "https://www.amazon.com/Best-Sellers-Headphones/zgbs/electronics/12097479011",
  monitors: "https://www.amazon.com/Best-Sellers-Computer-Monitors/zgbs/pc/1292115011",
};

// Valid categories
const VALID_CATEGORIES = ["all", "phones", "computers", "audio", "monitors"];
type CategoryType = "all" | "phones" | "computers" | "audio" | "monitors";

// Default exclusion keywords to filter out books (only for 'all' category)
const DEFAULT_EXCLUDE_KEYWORDS = {
  title_keywords: ["Kindle", "Audible", "Paperback", "Hardcover", "Audiobook", "Book Set", "Novel", "Workbook"],
  url_patterns: ["/books/", "/Kindle/", "/Audible/"],
};

interface CatalogHomeResponse {
  status: "success" | "error";
  env: string;
  category: string;
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
  category: string,
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
    category,
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
 * Check if a product should be excluded (e.g., books) - only used for 'all' category
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
 * Fetch products from a single category URL with deduplication
 */
async function fetchCategoryProducts(
  categoryUrl: string,
  amazonDomain: string,
  page: number,
  pageSize: number,
  applyExclusion: boolean,
  excludeConfig: ExcludeConfig
): Promise<{ products: any[]; beforeDedupe: number; afterDedupe: number; hasMore: boolean }> {
  // Fetch extra items to have buffer after filtering/deduping
  const fetchSize = pageSize * 2;
  
  const result = await fetchBestsellers(amazonDomain, page, fetchSize, categoryUrl);
  
  if (result.error || !result.products || result.products.length === 0) {
    return { products: [], beforeDedupe: 0, afterDedupe: 0, hasMore: false };
  }
  
  // Format and dedupe by ASIN
  const seenIds = new Map<string, any>();
  
  for (const product of result.products) {
    const formatted = formatCatalogItem(product);
    const id = formatted.id;
    
    // Dedupe by id (rainforest:ASIN)
    if (!seenIds.has(id)) {
      seenIds.set(id, formatted);
    }
  }
  
  const beforeDedupe = result.products.length;
  let deduped = Array.from(seenIds.values());
  
  // Apply exclusion filter if needed (for 'all' category)
  if (applyExclusion) {
    deduped = deduped.filter(p => !shouldExcludeProduct(p, excludeConfig));
  }
  
  const afterDedupe = deduped.length;
  
  // Slice to requested page size
  const products = deduped.slice(0, pageSize);
  const hasMore = afterDedupe > pageSize || result.hasMore;
  
  return { products, beforeDedupe, afterDedupe, hasMore };
}

/**
 * Load exclusion config from catalog_config table
 */
async function loadExcludeConfig(supabase: any): Promise<ExcludeConfig> {
  try {
    const { data, error } = await supabase
      .from("catalog_config")
      .select("key, value")
      .eq("key", "home_exclude_keywords")
      .single();
    
    if (error || !data) {
      return DEFAULT_EXCLUDE_KEYWORDS;
    }
    
    return {
      title_keywords: data.value?.title_keywords || DEFAULT_EXCLUDE_KEYWORDS.title_keywords,
      url_patterns: data.value?.url_patterns || DEFAULT_EXCLUDE_KEYWORDS.url_patterns,
    };
  } catch {
    return DEFAULT_EXCLUDE_KEYWORDS;
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
  
  // Parse category (default to 'all')
  const rawCategory = (url.searchParams.get("category") || "all").toLowerCase();
  const category: CategoryType = VALID_CATEGORIES.includes(rawCategory) 
    ? rawCategory as CategoryType 
    : "all";
  
  // Detect environment from header or query param
  const envName = getEnvironmentFromRequest(req);
  
  console.log(`[CATALOG_HOME] category=${category} page=${page} pageSize=${pageSize} env=${envName}`);

  // Default error response - always return this shape
  const errorResponse = (message: string, source: string = "error") => 
    new Response(JSON.stringify(buildResponse("error", envName, category, page, pageSize, [], false, source, message)), {
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

    // Load exclusion config (only used for 'all' category)
    const excludeConfig = await loadExcludeConfig(supabase);
    
    // Get the URL for the requested category
    const categoryUrl = CATEGORY_URLS[category] || CATEGORY_URLS.all;
    const applyExclusion = category === "all"; // Only filter books in 'all' category
    
    let trending: any[] = [];
    let hasMore = false;
    let source = `bestsellers-${category}`;
    let beforeDedupe = 0;
    let afterDedupe = 0;
    
    // Fetch from the specific category URL
    const result = await fetchCategoryProducts(
      categoryUrl,
      amazonDomain,
      page,
      pageSize,
      applyExclusion,
      excludeConfig
    );
    
    trending = result.products;
    hasMore = result.hasMore;
    beforeDedupe = result.beforeDedupe;
    afterDedupe = result.afterDedupe;
    
    console.log(`[CATALOG_HOME] category=${category} page=${page} pageSize=${pageSize} returned=${trending.length} deduped=${beforeDedupe - afterDedupe}`);
    
    // FALLBACK 1: If category fetch failed, try search with category-specific terms
    if (trending.length === 0) {
      console.log(`[CATALOG_HOME] Using search fallback for category=${category}`);
      
      const searchTerms: Record<string, string> = {
        all: "electronics",
        phones: "smartphone",
        computers: "laptop computer",
        audio: "headphones",
        monitors: "computer monitor",
      };
      
      const searchQuery = searchTerms[category] || "electronics";
      
      const searchResult = await searchRainforest(
        searchQuery,
        page,
        pageSize,
        amazonDomain
      );
      
      if (!searchResult.error && searchResult.products.length > 0) {
        // Dedupe search results
        const seenIds = new Map<string, any>();
        for (const product of searchResult.products) {
          const formatted = formatCatalogItem(product);
          if (!seenIds.has(formatted.id)) {
            seenIds.set(formatted.id, formatted);
          }
        }
        
        let deduped = Array.from(seenIds.values());
        
        // Apply exclusion filter for 'all' category
        if (applyExclusion) {
          deduped = deduped.filter(p => !shouldExcludeProduct(p, excludeConfig));
        }
        
        trending = deduped.slice(0, pageSize);
        hasMore = searchResult.hasMore;
        source = `search-${category}`;
        
        console.log(`[CATALOG_HOME] Search fallback successful: query=${searchQuery} returned=${trending.length}`);
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
        // Dedupe cached products
        const seenIds = new Map<string, any>();
        
        for (const p of cachedProducts) {
          const formatted = {
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
          };
          
          if (!seenIds.has(formatted.id)) {
            seenIds.set(formatted.id, formatted);
          }
        }
        
        let deduped = Array.from(seenIds.values());
        
        // Apply exclusion filter for 'all' category
        if (applyExclusion) {
          deduped = deduped.filter((p: any) => !shouldExcludeProduct(p, excludeConfig));
        }
        
        trending = deduped;
        hasMore = count !== null ? (offset + trending.length) < count : false;
        source = "cache-fallback";
      }
    }

    // If still no products and all fallbacks failed, return error status
    if (trending.length === 0) {
      console.log(`[CATALOG_HOME] category=${category} page=${page} status=error error=NO_PRODUCTS durationMs=${Date.now() - startTime}`);
      return errorResponse("Trending products temporarily unavailable", "no-products");
    }

    // Log success
    console.log(`[CATALOG_HOME] category=${category} page=${page} pageSize=${pageSize} returned=${trending.length} source=${source} durationMs=${Date.now() - startTime}`);

    return new Response(JSON.stringify(buildResponse(
      "success",
      envName,
      category,
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
    console.error(`[CATALOG_HOME] category=${category} page=${page} status=error error=${errorMessage} durationMs=${Date.now() - startTime}`);
    
    // Even on error, return 200 with stable shape
    return errorResponse("Catalog service temporarily unavailable");
  }
});
