/**
 * Catalog Aggregator
 * Aggregates search results from multiple providers
 * Handles caching, deduplication, and priority-based sorting
 */

import { EnvironmentConfig } from "./environmentResolver.ts";
import {
  CatalogProduct,
  SearchFilters,
  SearchResult,
  ProviderConfig,
  getEnabledProviders,
  getProviderAdapter,
  getCachedProducts,
  cacheProducts,
} from "./catalogProviders.ts";
import { checkRateLimit } from "./rateLimiter.ts";

const PAGE_SIZE = 20;

export interface AggregatedSearchResult {
  success: boolean;
  query: string;
  page: number;
  pageSize: number;
  totalResults: number;
  hasMore: boolean;
  products: CatalogProduct[];
  providers: string[];
  cacheHit: boolean;
  durationMs: number;
}

/**
 * Search across all enabled providers
 */
export async function aggregatedSearch(
  supabase: any,
  query: string,
  page: number,
  filters: SearchFilters,
  envConfig: EnvironmentConfig | null
): Promise<AggregatedSearchResult> {
  const startTime = Date.now();
  const envName = envConfig?.name || "production";

  console.log("[CATALOG_DEBUG]", JSON.stringify({
    fn: "aggregatedSearch",
    env: envName,
    query,
    page,
    filters,
  }));

  // 1. Check cache first for quick response
  const cachedProducts = await getCachedProducts(supabase, query, PAGE_SIZE * 2);
  
  if (cachedProducts.length >= PAGE_SIZE) {
    console.log("[CATALOG_DEBUG]", JSON.stringify({
      fn: "aggregatedSearch",
      cacheHit: true,
      resultCount: cachedProducts.length,
    }));

    const paginatedProducts = cachedProducts.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
    
    return {
      success: true,
      query,
      page,
      pageSize: PAGE_SIZE,
      totalResults: cachedProducts.length,
      hasMore: cachedProducts.length > page * PAGE_SIZE,
      products: paginatedProducts,
      providers: [...new Set(paginatedProducts.map(p => p.providerName || "unknown"))],
      cacheHit: true,
      durationMs: Date.now() - startTime,
    };
  }

  // 2. Fetch from enabled providers
  const providers = await getEnabledProviders(supabase, envName);
  
  if (providers.length === 0) {
    console.log("[CATALOG_DEBUG]", JSON.stringify({
      fn: "aggregatedSearch",
      providersEnabled: [],
      warning: "No providers enabled",
    }));

    return {
      success: true,
      query,
      page,
      pageSize: PAGE_SIZE,
      totalResults: cachedProducts.length,
      hasMore: false,
      products: cachedProducts.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
      providers: [],
      cacheHit: cachedProducts.length > 0,
      durationMs: Date.now() - startTime,
    };
  }

  console.log("[CATALOG_DEBUG]", JSON.stringify({
    fn: "aggregatedSearch",
    providersEnabled: providers.map(p => p.name),
  }));

  // 3. Query all providers in parallel with rate limiting
  const providerResults = await Promise.allSettled(
    providers.map(async (provider) => {
      // Check rate limit
      const rateLimitKey = `catalog:${provider.name}`;
      const rateLimitResult = await checkRateLimit(
        supabase,
        rateLimitKey,
        provider.rateLimitPerMinute,
        1 // 1 minute window
      );

      if (!rateLimitResult.allowed) {
        console.warn(`[CATALOG_DEBUG] Rate limited: ${provider.name}`);
        return { provider: provider.name, products: [], error: "rate_limited" };
      }

      const adapter = getProviderAdapter(provider, envConfig);
      if (!adapter) {
        return { provider: provider.name, products: [], error: "no_adapter" };
      }

      try {
        const result = await adapter.search(query, page, filters);
        return { 
          provider: provider.name, 
          providerId: provider.id,
          products: result.products,
          priority: provider.priority,
        };
      } catch (err) {
        console.error(`[CATALOG_DEBUG] Provider ${provider.name} error:`, err);
        return { provider: provider.name, products: [], error: String(err) };
      }
    })
  );

  // 4. Merge and deduplicate results
  const allProducts: CatalogProduct[] = [];
  const successfulProviders: string[] = [];

  for (const result of providerResults) {
    if (result.status === "fulfilled" && result.value.products.length > 0) {
      // Add provider info to each product
      const productsWithProvider = result.value.products.map(p => ({
        ...p,
        providerName: result.value.provider,
        providerId: result.value.providerId,
      }));
      
      allProducts.push(...productsWithProvider);
      successfulProviders.push(result.value.provider);

      // Cache products asynchronously
      if (result.value.providerId) {
        cacheProducts(supabase, result.value.providerId, result.value.products)
          .catch(err => console.error("[CATALOG_DEBUG] Cache error:", err));
      }
    }
  }

  // 5. Deduplicate by title similarity
  const deduplicatedProducts = deduplicateProducts(allProducts);

  // 6. Sort by provider priority and relevance
  const sortedProducts = deduplicatedProducts.sort((a, b) => {
    // Find provider priorities
    const aPriority = providers.find(p => p.name === a.providerName)?.priority || 0;
    const bPriority = providers.find(p => p.name === b.providerName)?.priority || 0;
    
    // Higher priority first
    if (bPriority !== aPriority) return bPriority - aPriority;
    
    // Then by rating
    return (b.rating || 0) - (a.rating || 0);
  });

  // 7. Paginate
  const paginatedProducts = sortedProducts.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  console.log("[CATALOG_DEBUG]", JSON.stringify({
    fn: "aggregatedSearch",
    env: envName,
    cacheHit: false,
    resultCount: sortedProducts.length,
    returnedCount: paginatedProducts.length,
    durationMs: Date.now() - startTime,
  }));

  return {
    success: true,
    query,
    page,
    pageSize: PAGE_SIZE,
    totalResults: sortedProducts.length,
    hasMore: sortedProducts.length > page * PAGE_SIZE,
    products: paginatedProducts,
    providers: successfulProviders,
    cacheHit: false,
    durationMs: Date.now() - startTime,
  };
}

/**
 * Deduplicate products by title similarity
 * Uses simple lowercase comparison - could be enhanced with fuzzy matching
 */
function deduplicateProducts(products: CatalogProduct[]): CatalogProduct[] {
  const seen = new Map<string, CatalogProduct>();
  
  for (const product of products) {
    const normalizedTitle = normalizeTitle(product.title);
    
    // Check if we've seen a similar product
    const existing = seen.get(normalizedTitle);
    
    if (!existing) {
      seen.set(normalizedTitle, product);
    } else {
      // Keep the one with better rating or lower price
      if (
        (product.rating || 0) > (existing.rating || 0) ||
        product.priceUsd < existing.priceUsd
      ) {
        seen.set(normalizedTitle, product);
      }
    }
  }
  
  return Array.from(seen.values());
}

/**
 * Normalize title for comparison
 */
function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .substring(0, 50); // Compare first 50 chars
}

/**
 * Get featured content for home screen
 * Fetches from cache or Rainforest if empty
 */
export async function getFeaturedContent(
  supabase: any,
  envConfig: EnvironmentConfig | null
): Promise<{
  success: boolean;
  featured: { type: string; id: string; name: string; imageUrl?: string; productCount?: number }[];
  trending: CatalogProduct[];
  categories: { id: string; name: string; icon?: string; children?: any[] }[];
}> {
  const startTime = Date.now();
  const envName = envConfig?.name || "production";
  
  // Get categories
  const { data: categories } = await supabase
    .from("catalog_categories")
    .select("id, name, icon_url, parent_id, priority")
    .is("parent_id", null)
    .eq("enabled", true)
    .order("priority", { ascending: false })
    .limit(10);

  // Get some cached products as "trending"
  let { data: trending } = await supabase
    .from("catalog_products")
    .select("*")
    .gt("expires_at", new Date().toISOString())
    .order("rating", { ascending: false })
    .limit(12);

  // If cache is empty and we're in staging, fetch from Rainforest
  if ((!trending || trending.length < 5) && envName === "staging") {
    console.log("[CATALOG_DEBUG]", JSON.stringify({
      fn: "getFeaturedContent",
      env: envName,
      action: "fetching_from_providers",
      reason: "cache_empty",
      cachedCount: trending?.length || 0,
    }));

    // Get enabled providers
    const providers = await getEnabledProviders(supabase, envName);
    
    console.log("[CATALOG_DEBUG]", JSON.stringify({
      fn: "getFeaturedContent",
      providersEnabled: providers.map(p => p.name),
    }));

    if (providers.length > 0) {
      // Fetch products using popular search terms
      const searchTerms = ["smartphone", "laptop", "headphones", "tablet", "smartwatch"];
      const allProducts: CatalogProduct[] = [];

      for (const provider of providers) {
        const adapter = getProviderAdapter(provider, envConfig);
        if (!adapter) continue;

        try {
          // Search for each term and collect products
          for (const term of searchTerms.slice(0, 3)) { // Limit to 3 terms to save API credits
            const result = await adapter.search(term, 1, {});
            if (result.products.length > 0) {
              const productsWithProvider = result.products.slice(0, 4).map(p => ({
                ...p,
                providerName: provider.name,
                providerId: provider.id,
              }));
              allProducts.push(...productsWithProvider);

              // Cache the products
              cacheProducts(supabase, provider.id, result.products.slice(0, 10))
                .catch(err => console.error("[CATALOG_DEBUG] Cache error:", err));
            }
          }
        } catch (err) {
          console.error(`[getFeaturedContent] Provider ${provider.name} error:`, err);
        }
      }

      // Deduplicate and use as trending
      if (allProducts.length > 0) {
        const seen = new Set<string>();
        trending = allProducts.filter(p => {
          const key = p.providerProductId;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        }).slice(0, 12);

        console.log("[CATALOG_DEBUG]", JSON.stringify({
          fn: "getFeaturedContent",
          env: envName,
          action: "fetched_from_providers",
          productCount: trending.length,
        }));
      }
    }
  }

  console.log("[CATALOG_DEBUG]", JSON.stringify({
    fn: "getFeaturedContent",
    env: envName,
    categoriesCount: categories?.length || 0,
    trendingCount: trending?.length || 0,
    durationMs: Date.now() - startTime,
  }));

  // Format trending products
  const formattedTrending = (trending || []).map((p: any) => {
    // Handle both raw Rainforest products and cached DB products
    if (p.providerProductId) {
      // Already formatted CatalogProduct
      return p;
    }
    // From database
    return {
      id: p.id,
      providerProductId: p.provider_product_id,
      providerName: p.providerName || "amazon",
      title: p.title || "",
      imageUrl: p.image_url,
      productUrl: p.product_url || "",
      priceUsd: Number(p.price_usd) || 0,
      currency: p.currency || "USD",
      inStock: p.in_stock ?? true,
      rating: p.rating ? Number(p.rating) : undefined,
      reviewCount: p.review_count,
    };
  });

  return {
    success: true,
    featured: (categories || []).map((c: any) => ({
      type: "category",
      id: c.id,
      name: c.name,
      imageUrl: c.icon_url,
    })),
    trending: formattedTrending,
    categories: (categories || []).map((c: any) => ({
      id: c.id,
      name: c.name,
      icon: c.icon_url,
    })),
  };
}
