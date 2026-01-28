/**
 * Catalog Home Endpoint with Smart Caching
 * Returns featured/trending content for the native catalog home screen
 * GET /catalog-home?env=staging&page=1&pageSize=20&category=phones&amazon_domain=amazon.com
 * 
 * Cache strategy: stale=15min, expire=60min
 * 
 * IMPORTANT: This endpoint MUST always return HTTP 200 with stable JSON shape.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { getEnvironmentFromRequest, getEnvironmentConfig, isCatalogEnabled } from "../_shared/environmentResolver.ts";
import { fetchBestsellers, searchRainforest, formatCatalogItem } from "../_shared/rainforestAdapter.ts";
import { 
  buildCacheKey, 
  getCache, 
  setCache, 
  checkRateLimit, 
  rateLimitResponse, 
  getDeviceId,
  addCacheMetadata
} from "../_shared/catalogCache.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-afrishop-environment, x-device-id",
  "Cache-Control": "public, max-age=300",
};

const MAX_PAGE_SIZE = 40;
const DEFAULT_PAGE_SIZE = 20;
const DEFAULT_AMAZON_DOMAIN = "amazon.com";

// Category-specific Amazon Best Sellers URLs
const CATEGORY_URLS: Record<string, string[]> = {
  all: [
    "https://www.amazon.com/Best-Sellers-Electronics/zgbs/electronics",
    "https://www.amazon.com/Best-Sellers-Cell-Phones-Accessories/zgbs/wireless",
    "https://www.amazon.com/Best-Sellers-Computers-Accessories/zgbs/pc",
    "https://www.amazon.com/Best-Sellers-Headphones/zgbs/electronics/12097479011",
  ],
  phones: ["https://www.amazon.com/Best-Sellers-Cell-Phones-Accessories/zgbs/wireless"],
  computers: ["https://www.amazon.com/Best-Sellers-Computers-Accessories/zgbs/pc"],
  audio: ["https://www.amazon.com/Best-Sellers-Headphones/zgbs/electronics/12097479011"],
  monitors: ["https://www.amazon.com/Best-Sellers-Computer-Monitors/zgbs/pc/1292115011"],
};

const VALID_CATEGORIES = ["all", "phones", "computers", "audio", "monitors"];
type CategoryType = "all" | "phones" | "computers" | "audio" | "monitors";

const DEFAULT_EXCLUDE_KEYWORDS = {
  title_keywords: ["Kindle", "Audible", "Paperback", "Hardcover", "Audiobook", "Book Set", "Novel", "Workbook"],
  url_patterns: ["/books/", "/Kindle/", "/Audible/"],
};

interface ExcludeConfig {
  title_keywords: string[];
  url_patterns: string[];
}

function shouldExcludeProduct(product: any, excludeConfig: ExcludeConfig): boolean {
  const title = (product.title || "").toLowerCase();
  const productUrl = (product.productUrl || product.link || "").toLowerCase();
  
  for (const keyword of excludeConfig.title_keywords) {
    if (title.includes(keyword.toLowerCase())) return true;
  }
  for (const pattern of excludeConfig.url_patterns) {
    if (productUrl.includes(pattern.toLowerCase())) return true;
  }
  return false;
}

async function fetchMultiCategoryProducts(
  categoryUrls: string[],
  amazonDomain: string,
  page: number,
  pageSize: number,
  applyExclusion: boolean,
  excludeConfig: ExcludeConfig
): Promise<{ products: any[]; hasMore: boolean; categoriesUsed: number }> {
  const results = await Promise.allSettled(
    categoryUrls.map(url => fetchBestsellers(amazonDomain, page, pageSize, url))
  );
  
  const seenIds = new Map<string, any>();
  let categoriesUsed = 0;
  
  for (const result of results) {
    if (result.status === "fulfilled" && !result.value.error && result.value.products.length > 0) {
      categoriesUsed++;
      for (const product of result.value.products) {
        const formatted = formatCatalogItem(product);
        if (!seenIds.has(formatted.id)) {
          seenIds.set(formatted.id, formatted);
        }
      }
    }
  }
  
  let deduped = Array.from(seenIds.values());
  if (applyExclusion) {
    deduped = deduped.filter(p => !shouldExcludeProduct(p, excludeConfig));
  }
  
  const products = deduped.slice(0, pageSize);
  const hasMore = deduped.length > pageSize;
  
  return { products, hasMore, categoriesUsed };
}

async function fetchSingleCategoryProducts(
  categoryUrl: string,
  amazonDomain: string,
  page: number,
  pageSize: number
): Promise<{ products: any[]; hasMore: boolean }> {
  const result = await fetchBestsellers(amazonDomain, page, pageSize * 2, categoryUrl);
  
  if (result.error || !result.products || result.products.length === 0) {
    return { products: [], hasMore: false };
  }
  
  const seenIds = new Map<string, any>();
  for (const product of result.products) {
    const formatted = formatCatalogItem(product);
    if (!seenIds.has(formatted.id)) {
      seenIds.set(formatted.id, formatted);
    }
  }
  
  const deduped = Array.from(seenIds.values());
  const products = deduped.slice(0, pageSize);
  const hasMore = deduped.length > pageSize || result.hasMore;
  
  return { products, hasMore };
}

async function loadExcludeConfig(supabase: any): Promise<ExcludeConfig> {
  try {
    const { data } = await supabase
      .from("catalog_config")
      .select("key, value")
      .eq("key", "home_exclude_keywords")
      .single();
    
    if (!data) return DEFAULT_EXCLUDE_KEYWORDS;
    return {
      title_keywords: data.value?.title_keywords || DEFAULT_EXCLUDE_KEYWORDS.title_keywords,
      url_patterns: data.value?.url_patterns || DEFAULT_EXCLUDE_KEYWORDS.url_patterns,
    };
  } catch {
    return DEFAULT_EXCLUDE_KEYWORDS;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  const url = new URL(req.url);
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, parseInt(url.searchParams.get("pageSize") || String(DEFAULT_PAGE_SIZE), 10)));
  const amazonDomain = url.searchParams.get("amazon_domain") || DEFAULT_AMAZON_DOMAIN;
  const rawCategory = (url.searchParams.get("category") || "all").toLowerCase();
  const category: CategoryType = VALID_CATEGORIES.includes(rawCategory) ? rawCategory as CategoryType : "all";
  const envName = getEnvironmentFromRequest(req);
  const deviceId = getDeviceId(req);
  const isStaging = envName === "staging";

  const buildResponse = (status: "success" | "error", trending: any[], hasMore: boolean, source: string, error: string | null, cacheData?: any) => {
    const base = {
      status,
      env: envName,
      category,
      page,
      pageSize,
      trending,
      itemCount: trending.length,
      hasMore,
      source,
      error,
    };
    return cacheData ? addCacheMetadata(base, cacheData, isStaging) : base;
  };

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    
    if (!supabaseUrl || !supabaseKey) {
      return new Response(JSON.stringify(buildResponse("error", [], false, "error", "Backend configuration error")), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    // Rate limiting
    const rateLimit = await checkRateLimit(supabase, deviceId, "home");
    if (!rateLimit.allowed) {
      console.log(`[CATALOG_HOME] Rate limited device=${deviceId} count=${rateLimit.count}`);
      return new Response(JSON.stringify(rateLimitResponse(rateLimit.resetAt)), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const envConfig = await getEnvironmentConfig(supabase, envName);
    if (!isCatalogEnabled(envConfig)) {
      return new Response(JSON.stringify(buildResponse("error", [], false, "error", "Catalog not enabled")), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Build cache key
    const cacheKey = buildCacheKey("home", {
      env: envName,
      domain: amazonDomain,
      category,
      page,
      pageSize,
    });

    // Check cache first
    const cacheResult = await getCache(supabase, cacheKey);
    
    if (cacheResult.hit) {
      const cached = cacheResult.data;
      console.log(`[CATALOG_HOME] Cache hit: key=${cacheKey} stale=${cacheResult.stale} age=${cacheResult.cacheAgeSec}s`);
      
      return new Response(JSON.stringify(buildResponse(
        "success",
        cached.trending || [],
        cached.hasMore || false,
        "cache",
        null,
        cacheResult
      )), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`[CATALOG_HOME] Cache miss: key=${cacheKey}`);

    // Load exclusion config
    const excludeConfig = await loadExcludeConfig(supabase);
    const categoryUrls = CATEGORY_URLS[category] || CATEGORY_URLS.all;
    const applyExclusion = category === "all";
    
    let trending: any[] = [];
    let hasMore = false;
    let source = `bestsellers-${category}`;
    
    // Fetch from Rainforest
    if (categoryUrls.length > 1) {
      const result = await fetchMultiCategoryProducts(categoryUrls, amazonDomain, page, pageSize, applyExclusion, excludeConfig);
      trending = result.products;
      hasMore = result.hasMore;
    } else {
      const result = await fetchSingleCategoryProducts(categoryUrls[0], amazonDomain, page, pageSize);
      trending = result.products;
      hasMore = result.hasMore;
    }
    
    // Fallback: search
    if (trending.length === 0) {
      const searchTerms: Record<string, string> = {
        all: "electronics",
        phones: "smartphone",
        computers: "laptop computer",
        audio: "headphones",
        monitors: "computer monitor",
      };
      
      const searchResult = await searchRainforest(searchTerms[category] || "electronics", page, pageSize, amazonDomain);
      
      if (!searchResult.error && searchResult.products.length > 0) {
        const seenIds = new Map<string, any>();
        for (const product of searchResult.products) {
          const formatted = formatCatalogItem(product);
          if (!seenIds.has(formatted.id)) seenIds.set(formatted.id, formatted);
        }
        let deduped = Array.from(seenIds.values());
        if (applyExclusion) deduped = deduped.filter(p => !shouldExcludeProduct(p, excludeConfig));
        trending = deduped.slice(0, pageSize);
        hasMore = searchResult.hasMore;
        source = `search-${category}`;
      }
    }
    
    // Fallback: database cache
    if (trending.length === 0) {
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
          images: p.raw?.images?.map((img: any) => img.link || img) || [],
          productUrl: p.product_url || null,
          inStock: p.in_stock ?? null,
          rating: p.rating || null,
        }));
        hasMore = count !== null ? (offset + trending.length) < count : false;
        source = "db-cache-fallback";
      }
    }

    // Cache the result if we got data
    if (trending.length > 0) {
      await setCache(supabase, "home", cacheKey, { trending, hasMore }, {
        category,
        page,
        pageSize,
        amazonDomain,
      });
    }

    console.log(`[CATALOG_HOME] category=${category} page=${page} returned=${trending.length} source=${source} durationMs=${Date.now() - startTime}`);

    return new Response(JSON.stringify(buildResponse("success", trending, hasMore, source, null)), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "Unknown error";
    console.error(`[CATALOG_HOME] Error: ${errorMessage} durationMs=${Date.now() - startTime}`);
    
    return new Response(JSON.stringify(buildResponse("error", [], false, "error", "Catalog service error")), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
