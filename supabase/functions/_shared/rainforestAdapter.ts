/**
 * Rainforest API Adapter
 * Connects to Rainforest API for Amazon product data
 * https://www.rainforestapi.com/docs/
 */

import {
  ProviderAdapter,
  CatalogProduct,
  SearchFilters,
  SearchResult,
  Category,
  ProviderConfig,
} from "./catalogProviders.ts";
import { EnvironmentConfig } from "./environmentResolver.ts";

const RAINFOREST_BASE_URL = "https://api.rainforestapi.com/request";
const DEFAULT_TIMEOUT_MS = 15000; // 15 second timeout for Rainforest API (product requests can be slow)

interface RainforestSearchParams {
  api_key: string;
  type: "search" | "product" | "category" | "bestsellers";
  amazon_domain: string;
  search_term?: string;
  asin?: string;
  category_id?: string;
  page?: number;
  sort_by?: string;
  url?: string; // For bestsellers type
}

interface RainforestProduct {
  asin: string;
  title: string;
  link: string;
  image?: string;
  main_image?: { link: string };
  images?: { link: string }[];
  price?: {
    value: number;
    currency: string;
    raw?: string;
  };
  // Additional price fields Rainforest may return
  current_price?: { value: number; currency: string; raw?: string };
  rrp?: { value: number; currency: string };
  rating?: number;
  ratings_total?: number;
  reviews_total?: number;
  is_prime?: boolean;
  is_amazon_fresh?: boolean;
  categories?: { name: string; link: string }[];
  brand?: string;
  description?: string;
  feature_bullets?: string[];
  buybox_winner?: {
    price?: { value: number; currency: string };
    is_prime?: boolean;
  };
  // For search results
  prices?: { value: number; currency: string; raw?: string }[];
}

interface RainforestSearchResponse {
  request_info: {
    success: boolean;
    credits_used: number;
    credits_remaining: number;
  };
  search_results?: RainforestProduct[];
  bestsellers?: RainforestProduct[];
  product?: RainforestProduct;
  pagination?: {
    current_page: number;
    total_pages: number;
    total_results: number;
    has_next_page?: boolean;
  };
  error?: {
    message: string;
    code: string;
  };
}

/**
 * Fetch with timeout support
 */
async function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    return response;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Create a Rainforest adapter for Amazon
 */
export function createRainforestAdapter(
  config: ProviderConfig,
  _env: EnvironmentConfig | null
): ProviderAdapter {
  const apiKey = Deno.env.get("RAINFOREST_API_KEY");
  const amazonDomain = (config.config.amazon_domain as string) || 
                       Deno.env.get("RAINFOREST_DEFAULT_DOMAIN") || 
                       "amazon.com";
  
  if (!apiKey) {
    console.error("[rainforestAdapter] RAINFOREST_API_KEY not configured");
  }

  return {
    name: config.name,

    async search(
      query: string,
      page: number,
      filters?: SearchFilters
    ): Promise<SearchResult> {
      if (!apiKey) {
        console.error("[rainforestAdapter] No API key, returning empty results");
        return {
          products: [],
          totalResults: 0,
          page,
          pageSize: 20,
          hasMore: false,
        };
      }

      const startTime = Date.now();

      try {
        const params: RainforestSearchParams = {
          api_key: apiKey,
          type: "search",
          amazon_domain: amazonDomain,
          search_term: query,
          page,
          sort_by: "featured",
        };

        // Build URL with params
        const url = new URL(RAINFOREST_BASE_URL);
        Object.entries(params).forEach(([key, value]) => {
          if (value !== undefined) {
            url.searchParams.append(key, String(value));
          }
        });

        console.log("[CATALOG_SEARCH]", JSON.stringify({
          q: query,
          page,
          domain: amazonDomain,
          type: "search",
        }));

        const response = await fetchWithTimeout(
          url.toString(),
          { method: "GET", headers: { "Accept": "application/json" } },
          DEFAULT_TIMEOUT_MS
        );

        if (!response.ok) {
          const errorText = await response.text();
          console.error("[rainforestAdapter] API error:", response.status, errorText);
          throw new Error(`Rainforest API error: ${response.status}`);
        }

        const data: RainforestSearchResponse = await response.json();

        if (data.error) {
          console.error("[rainforestAdapter] API returned error:", data.error);
          throw new Error(data.error.message);
        }

        const products = (data.search_results || [])
          .filter(p => p.asin && p.title)
          .map(p => normalizeProduct(p, amazonDomain));

        // Apply filters
        let filteredProducts = products;
        if (filters?.minPrice) {
          filteredProducts = filteredProducts.filter(p => p.priceUsd >= filters.minPrice!);
        }
        if (filters?.maxPrice) {
          filteredProducts = filteredProducts.filter(p => p.priceUsd <= filters.maxPrice!);
        }

        console.log("[CATALOG_SEARCH]", JSON.stringify({
          q: query,
          page,
          status: "success",
          itemCount: filteredProducts.length,
          totalResults: data.pagination?.total_results || filteredProducts.length,
          durationMs: Date.now() - startTime,
        }));

        return {
          products: filteredProducts,
          totalResults: data.pagination?.total_results || filteredProducts.length,
          page,
          pageSize: filteredProducts.length,
          hasMore: (data.pagination?.current_page || 1) < (data.pagination?.total_pages || 1),
        };
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        console.error("[CATALOG_SEARCH]", JSON.stringify({
          q: query,
          page,
          status: "error",
          error: errorMsg,
          durationMs: Date.now() - startTime,
        }));
        return {
          products: [],
          totalResults: 0,
          page,
          pageSize: 20,
          hasMore: false,
        };
      }
    },

    async getProduct(asin: string): Promise<CatalogProduct | null> {
      if (!apiKey) {
        console.error("[rainforestAdapter] No API key");
        return null;
      }

      const startTime = Date.now();

      try {
        const params: RainforestSearchParams = {
          api_key: apiKey,
          type: "product",
          amazon_domain: amazonDomain,
          asin,
        };

        const url = new URL(RAINFOREST_BASE_URL);
        Object.entries(params).forEach(([key, value]) => {
          if (value !== undefined) {
            url.searchParams.append(key, String(value));
          }
        });

        console.log("[CATALOG_PRODUCT]", JSON.stringify({
          asin,
          domain: amazonDomain,
        }));

        const response = await fetchWithTimeout(
          url.toString(),
          { method: "GET", headers: { "Accept": "application/json" } },
          DEFAULT_TIMEOUT_MS
        );

        if (!response.ok) {
          throw new Error(`Rainforest API error: ${response.status}`);
        }

        const data: RainforestSearchResponse = await response.json();

        if (data.error || !data.product) {
          console.error("[CATALOG_PRODUCT]", JSON.stringify({
            asin,
            status: "not_found",
            durationMs: Date.now() - startTime,
          }));
          return null;
        }

        console.log("[CATALOG_PRODUCT]", JSON.stringify({
          asin,
          status: "success",
          durationMs: Date.now() - startTime,
        }));

        return normalizeProduct(data.product, amazonDomain);
      } catch (err) {
        console.error("[CATALOG_PRODUCT]", JSON.stringify({
          asin,
          status: "error",
          error: err instanceof Error ? err.message : String(err),
        }));
        return null;
      }
    },

    async getCategories(): Promise<Category[]> {
      // Amazon categories are dynamic, return a static list of popular ones
      return [
        { id: "electronics", name: "Electronics" },
        { id: "computers", name: "Computers" },
        { id: "clothing", name: "Clothing" },
        { id: "home", name: "Home & Kitchen" },
        { id: "beauty", name: "Beauty" },
        { id: "toys", name: "Toys & Games" },
        { id: "sports", name: "Sports & Outdoors" },
        { id: "baby", name: "Baby" },
        { id: "books", name: "Books" },
        { id: "office", name: "Office Products" },
      ];
    },

    async healthCheck(): Promise<boolean> {
      return !!apiKey;
    },
  };
}

/**
 * Fetch bestsellers from Rainforest API
 * IMPORTANT: Rainforest requires either 'category_id' (node ID) OR 'url' for type=bestsellers
 * We use the bestsellers URL approach which is more reliable than category_id
 * 
 * Amazon Bestsellers URL: https://www.amazon.com/gp/bestsellers
 * Category-specific: https://www.amazon.com/Best-Sellers-Electronics/zgbs/electronics
 */
export async function fetchBestsellers(
  amazonDomain: string,
  page: number = 1,
  pageSize: number = 20,
  bestsellersUrl?: string,
  categoryId?: string
): Promise<{ products: CatalogProduct[]; total: number; hasMore: boolean; error: string | null }> {
  const apiKey = Deno.env.get("RAINFOREST_API_KEY");
  
  if (!apiKey) {
    console.error("[rainforestAdapter] No API key for bestsellers");
    return { products: [], total: 0, hasMore: false, error: "API_KEY_MISSING" };
  }

  const startTime = Date.now();
  
  // Amazon Bestsellers URLs by domain
  // Using the main bestsellers page is most reliable
  const BESTSELLERS_URLS: Record<string, string> = {
    "amazon.com": "https://www.amazon.com/gp/bestsellers",
    "amazon.co.uk": "https://www.amazon.co.uk/gp/bestsellers",
    "amazon.de": "https://www.amazon.de/gp/bestsellers",
    "amazon.fr": "https://www.amazon.fr/gp/bestsellers",
    "amazon.ca": "https://www.amazon.ca/gp/bestsellers",
  };
  
  try {
    const url = new URL(RAINFOREST_BASE_URL);
    url.searchParams.append("api_key", apiKey);
    url.searchParams.append("type", "bestsellers");
    
    // Determine what to use: explicit URL > explicit categoryId > default URL
    if (bestsellersUrl) {
      // When using URL, don't include amazon_domain (inferred from URL)
      url.searchParams.append("url", bestsellersUrl);
    } else if (categoryId) {
      // Category ID approach - requires amazon_domain
      url.searchParams.append("amazon_domain", amazonDomain);
      url.searchParams.append("category_id", categoryId);
    } else {
      // Default: use bestsellers URL for the domain
      const defaultUrl = BESTSELLERS_URLS[amazonDomain] || BESTSELLERS_URLS["amazon.com"];
      url.searchParams.append("url", defaultUrl);
    }
    
    // Page param for pagination
    if (page > 1) {
      url.searchParams.append("page", String(page));
    }

    console.log("[CATALOG_BESTSELLERS]", JSON.stringify({
      page,
      pageSize,
      domain: amazonDomain,
      hasExplicitUrl: !!bestsellersUrl,
      hasExplicitCategory: !!categoryId,
      usingDefaultUrl: !bestsellersUrl && !categoryId,
    }));

    const response = await fetchWithTimeout(
      url.toString(),
      { method: "GET", headers: { "Accept": "application/json" } },
      DEFAULT_TIMEOUT_MS
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error("[rainforestAdapter] Bestsellers error:", response.status, errorText);
      return { products: [], total: 0, hasMore: false, error: `HTTP_${response.status}` };
    }

    const data: RainforestSearchResponse = await response.json();

    // Debug: log response structure (no secrets)
    console.log("[CATALOG_BESTSELLERS_DEBUG]", JSON.stringify({
      hasRequestInfo: !!data.request_info,
      success: data.request_info?.success,
      hasBestsellers: !!data.bestsellers,
      bestsellersLen: data.bestsellers?.length ?? 0,
      hasSearchResults: !!data.search_results,
      searchResultsLen: data.search_results?.length ?? 0,
      hasError: !!data.error,
      errorMsg: data.error?.message,
      paginationInfo: data.pagination,
      // Log top-level keys (not values) to understand structure
      topKeys: Object.keys(data).filter(k => k !== 'request_info'),
    }));

    if (data.error) {
      console.error("[rainforestAdapter] Bestsellers API error:", data.error);
      return { products: [], total: 0, hasMore: false, error: data.error.code || "API_ERROR" };
    }

    // Bestsellers may be in 'bestsellers' field or variations like 'best_sellers'
    // deno-lint-ignore no-explicit-any
    const anyData = data as any;
    const rawProducts = data.bestsellers || 
                        anyData.best_sellers || 
                        anyData.ranking_products ||
                        data.search_results || 
                        [];
    
    // Check if there are more pages
    const pagination = data.pagination;
    const hasNextPage = pagination?.has_next_page === true;
    const totalResults = pagination?.total_results || rawProducts.length;
    
    const products = rawProducts
      .filter((p: RainforestProduct) => p.asin && p.title)
      .slice(0, pageSize)
      .map((p: RainforestProduct) => normalizeProduct(p, amazonDomain));

    // Compute hasMore: true if Rainforest indicates more pages OR we have exactly pageSize items
    const hasMore = hasNextPage || products.length >= pageSize;

    console.log("[CATALOG_BESTSELLERS]", JSON.stringify({
      page,
      pageSize,
      status: "success",
      rawCount: rawProducts.length,
      itemCount: products.length,
      totalResults,
      hasNextPage,
      hasMore,
      durationMs: Date.now() - startTime,
    }));

    return {
      products,
      total: totalResults,
      hasMore,
      error: null,
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error("[CATALOG_BESTSELLERS]", JSON.stringify({
      page,
      pageSize,
      status: "error",
      error: errorMsg,
      durationMs: Date.now() - startTime,
    }));
    return { products: [], total: 0, hasMore: false, error: errorMsg };
  }
}

/**
 * Direct search call for use by edge functions
 */
export async function searchRainforest(
  query: string,
  page: number = 1,
  pageSize: number = 20,
  amazonDomain: string = "amazon.com"
): Promise<{ products: CatalogProduct[]; total: number; hasMore: boolean; error: string | null }> {
  const apiKey = Deno.env.get("RAINFOREST_API_KEY");
  
  if (!apiKey) {
    console.error("[rainforestAdapter] No API key for search");
    return { products: [], total: 0, hasMore: false, error: "API_KEY_MISSING" };
  }

  const startTime = Date.now();

  try {
    const params: RainforestSearchParams = {
      api_key: apiKey,
      type: "search",
      amazon_domain: amazonDomain,
      search_term: query,
      page,
      sort_by: "featured",
    };

    const url = new URL(RAINFOREST_BASE_URL);
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined) {
        url.searchParams.append(key, String(value));
      }
    });

    console.log("[CATALOG_SEARCH]", JSON.stringify({
      q: query,
      page,
      pageSize,
      domain: amazonDomain,
    }));

    const response = await fetchWithTimeout(
      url.toString(),
      { method: "GET", headers: { "Accept": "application/json" } },
      DEFAULT_TIMEOUT_MS
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error("[rainforestAdapter] Search error:", response.status, errorText);
      return { products: [], total: 0, hasMore: false, error: `HTTP_${response.status}` };
    }

    const data: RainforestSearchResponse = await response.json();

    if (data.error) {
      console.error("[rainforestAdapter] Search API error:", data.error);
      return { products: [], total: 0, hasMore: false, error: data.error.code || "API_ERROR" };
    }

    const products = (data.search_results || [])
      .filter((p: RainforestProduct) => p.asin && p.title)
      .slice(0, pageSize)
      .map((p: RainforestProduct) => normalizeProduct(p, amazonDomain));

    console.log("[CATALOG_SEARCH]", JSON.stringify({
      q: query,
      page,
      status: "success",
      itemCount: products.length,
      totalResults: data.pagination?.total_results || products.length,
      durationMs: Date.now() - startTime,
    }));

    // Compute hasMore based on pagination
    const hasNextPage = data.pagination?.has_next_page === true;
    const hasMore = hasNextPage || products.length >= pageSize;

    return {
      products,
      total: data.pagination?.total_results || products.length,
      hasMore,
      error: null,
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error("[CATALOG_SEARCH]", JSON.stringify({
      q: query,
      page,
      status: "error",
      error: errorMsg,
      durationMs: Date.now() - startTime,
    }));
    return { products: [], total: 0, hasMore: false, error: errorMsg };
  }
}

/**
 * Fetch single product details
 * Returns detailed product info with images, description, etc.
 */
export async function fetchProductDetails(
  asin: string,
  amazonDomain: string = "amazon.com"
): Promise<{ product: CatalogProduct | null; error: string | null }> {
  const apiKey = Deno.env.get("RAINFOREST_API_KEY");
  
  if (!apiKey) {
    console.error("[rainforestAdapter] No API key for product");
    return { product: null, error: "API_KEY_MISSING" };
  }

  // Validate ASIN format (should be alphanumeric, typically 10 chars)
  const cleanAsin = asin.trim().toUpperCase();
  if (!cleanAsin || cleanAsin.length < 5) {
    console.error("[rainforestAdapter] Invalid ASIN:", asin);
    return { product: null, error: "INVALID_ASIN" };
  }

  const startTime = Date.now();

  try {
    const url = new URL(RAINFOREST_BASE_URL);
    url.searchParams.append("api_key", apiKey);
    url.searchParams.append("type", "product");
    url.searchParams.append("amazon_domain", amazonDomain);
    url.searchParams.append("asin", cleanAsin);

    console.log("[CATALOG_PRODUCT] Fetching from Rainforest:", JSON.stringify({
      asin: cleanAsin,
      domain: amazonDomain,
    }));

    const response = await fetchWithTimeout(
      url.toString(),
      { method: "GET", headers: { "Accept": "application/json" } },
      DEFAULT_TIMEOUT_MS
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error("[rainforestAdapter] Product fetch error:", response.status, errorText.slice(0, 200));
      return { product: null, error: `HTTP_${response.status}` };
    }

    const data: RainforestSearchResponse = await response.json();

    if (data.error) {
      console.error("[CATALOG_PRODUCT] Rainforest error:", data.error);
      return { product: null, error: data.error.code || "RAINFOREST_ERROR" };
    }

    if (!data.product) {
      console.log("[CATALOG_PRODUCT] No product in response for:", cleanAsin);
      return { product: null, error: "PRODUCT_NOT_FOUND" };
    }

    const product = normalizeProduct(data.product, amazonDomain);

    console.log("[CATALOG_PRODUCT]", JSON.stringify({
      asin: cleanAsin,
      status: "success",
      title: product.title?.slice(0, 50),
      durationMs: Date.now() - startTime,
    }));

    return { product, error: null };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error("[CATALOG_PRODUCT] Exception:", JSON.stringify({
      asin: cleanAsin,
      error: errorMsg,
      durationMs: Date.now() - startTime,
    }));
    return { product: null, error: errorMsg };
  }
}

/**
 * Extract best available price from Rainforest product
 * Returns null if no valid price found (NEVER returns 0 for missing price)
 * 
 * Rainforest returns prices in various fields depending on product type:
 * - buybox_winner.price - Best price from active seller
 * - price - Main product price
 * - current_price - Current discounted price
 * - prices[] - Array of prices from different sellers
 * - rrp - Recommended retail price (fallback)
 */
function extractPrice(product: RainforestProduct): { value: number | null; currency: string; source: string } {
  // Try multiple price fields in order of preference
  const priceChecks: Array<{ name: string; field: any }> = [
    { name: "buybox_winner", field: product.buybox_winner?.price },
    { name: "price", field: product.price },
    { name: "current_price", field: product.current_price },
    { name: "prices[0]", field: product.prices?.[0] },
    { name: "rrp", field: product.rrp },
  ];

  for (const { name, field } of priceChecks) {
    if (field && typeof field.value === "number" && field.value > 0) {
      console.log(`[PRICE_DEBUG] Found price from ${name}: $${field.value} ${field.currency || "USD"}`);
      return { value: field.value, currency: field.currency || "USD", source: name };
    }
  }

  // Log when no price found for debugging
  console.log("[PRICE_DEBUG] No price found in product:", JSON.stringify({
    asin: product.asin,
    hasBuybox: !!product.buybox_winner,
    hasPrice: !!product.price,
    hasCurrentPrice: !!product.current_price,
    hasPrices: !!(product.prices && product.prices.length > 0),
    hasRrp: !!product.rrp,
  }));

  return { value: null, currency: "USD", source: "none" };
}

/**
 * Extract images array from Rainforest product
 * Returns array of https URLs, preferring high-res variants
 * Max 10 images, deduplicated
 * 
 * Rainforest API returns images in varying fields depending on product:
 * - product.images[] - array of {link, variant, large, medium} or strings
 * - product.image_gallery[] - alternate gallery format
 * - result.images[] / result.image_gallery[] - sometimes at root level
 * - product.main_image / product.image - single hero image
 * - product.hi_res_images[] / product.images_flat[] - rare variants
 * - product.variants[].main_image - variant images
 */
function extractImages(product: RainforestProduct): string[] {
  const seen = new Set<string>();
  const images: string[] = [];
  const rawProduct = product as any; // For accessing non-typed fields
  
  /**
   * Add image URL to array, normalizing to https
   */
  const addImage = (url: string | undefined | null, prepend = false) => {
    if (!url || typeof url !== "string") return;
    let cleanUrl = url.trim();
    
    // Normalize to https
    if (cleanUrl.startsWith("//")) {
      cleanUrl = `https:${cleanUrl}`;
    } else if (!cleanUrl.startsWith("http")) {
      cleanUrl = `https://${cleanUrl}`;
    }
    
    // Skip invalid or already seen
    if (!cleanUrl.startsWith("https://") || seen.has(cleanUrl)) return;
    
    seen.add(cleanUrl);
    if (prepend) {
      images.unshift(cleanUrl);
    } else {
      images.push(cleanUrl);
    }
  };

  /**
   * Extract URL from an image object or string
   * Rainforest uses various field names: link, url, src, large, hi_res
   */
  const extractUrl = (img: any): string | null => {
    if (typeof img === "string") return img;
    if (!img || typeof img !== "object") return null;
    
    // Prefer high-res variants
    return img.large || img.hi_res || img.link || img.url || img.src || img.medium || null;
  };

  // === Source 1: product.images[] (primary source) ===
  if (rawProduct.images && Array.isArray(rawProduct.images)) {
    for (const img of rawProduct.images) {
      addImage(extractUrl(img));
    }
  }

  // === Source 2: product.image_gallery[] ===
  if (rawProduct.image_gallery && Array.isArray(rawProduct.image_gallery)) {
    for (const img of rawProduct.image_gallery) {
      addImage(extractUrl(img));
    }
  }

  // === Source 3: root level images[] (some API responses) ===
  if (rawProduct.result?.images && Array.isArray(rawProduct.result.images)) {
    for (const img of rawProduct.result.images) {
      addImage(extractUrl(img));
    }
  }

  // === Source 4: root level image_gallery[] ===
  if (rawProduct.result?.image_gallery && Array.isArray(rawProduct.result.image_gallery)) {
    for (const img of rawProduct.result.image_gallery) {
      addImage(extractUrl(img));
    }
  }

  // === Source 5: hi_res_images[] (high resolution variant) ===
  if (rawProduct.hi_res_images && Array.isArray(rawProduct.hi_res_images)) {
    for (const img of rawProduct.hi_res_images) {
      addImage(extractUrl(img));
    }
  }

  // === Source 6: images_flat[] (flat list variant) ===
  if (rawProduct.images_flat && Array.isArray(rawProduct.images_flat)) {
    for (const img of rawProduct.images_flat) {
      addImage(extractUrl(img));
    }
  }

  // === Source 7: variants with images ===
  if (rawProduct.variants && Array.isArray(rawProduct.variants)) {
    for (const variant of rawProduct.variants) {
      if (variant.main_image) {
        addImage(typeof variant.main_image === "string" ? variant.main_image : variant.main_image?.link);
      }
      if (variant.images && Array.isArray(variant.images)) {
        for (const img of variant.images.slice(0, 3)) { // Limit variant images
          addImage(extractUrl(img));
        }
      }
    }
  }

  // === Source 8: main_image (prepend as primary) ===
  if (rawProduct.main_image) {
    const mainUrl = typeof rawProduct.main_image === "string" 
      ? rawProduct.main_image 
      : rawProduct.main_image?.link;
    addImage(mainUrl, true); // prepend to make it first
  }

  // === Source 9: Single image field fallback ===
  if (rawProduct.image && typeof rawProduct.image === "string") {
    addImage(rawProduct.image, true);
  }

  // === Source 10: thumbnail / small_image fallback (last resort) ===
  if (rawProduct.thumbnail) {
    addImage(typeof rawProduct.thumbnail === "string" ? rawProduct.thumbnail : rawProduct.thumbnail?.link);
  }
  if (rawProduct.small_image) {
    addImage(typeof rawProduct.small_image === "string" ? rawProduct.small_image : rawProduct.small_image?.link);
  }

  // Log for debugging (structured format requested)
  console.log("[CATALOG_PRODUCT_IMAGES]", JSON.stringify({
    asin: product.asin,
    imagesLen: images.length,
    hasMain: !!rawProduct.main_image,
    sources: {
      images: rawProduct.images?.length || 0,
      gallery: rawProduct.image_gallery?.length || 0,
      hiRes: rawProduct.hi_res_images?.length || 0,
      variants: rawProduct.variants?.length || 0,
    },
  }));

  // Return max 10 images (deduplicated)
  return images.slice(0, 10);
}

/**
 * Normalize Rainforest product to our catalog format
 * CRITICAL: priceUsd is null (not 0) when price is unavailable
 */
function normalizeProduct(
  product: RainforestProduct,
  amazonDomain: string
): CatalogProduct {
  // Extract price - null if unavailable, never 0
  const { value: rawPrice, currency, source: priceSource } = extractPrice(product);

  // Convert non-USD prices (approximate)
  let priceUsd: number | null = rawPrice;
  if (rawPrice !== null && currency !== "USD") {
    const conversionRates: Record<string, number> = {
      "GBP": 1.27,
      "EUR": 1.09,
      "CAD": 0.74,
      "AUD": 0.65,
      "JPY": 0.0067,
      "INR": 0.012,
    };
    priceUsd = rawPrice * (conversionRates[currency] || 1);
  }

  // Round price if present
  if (priceUsd !== null) {
    priceUsd = Math.round(priceUsd * 100) / 100;
  }

  // Log final price for debugging
  console.log("[NORMALIZE_DEBUG]", JSON.stringify({
    asin: product.asin,
    priceSource,
    rawPrice,
    currency,
    priceUsd,
  }));

  // Extract images
  const images = extractImages(product);
  const imageUrl = images[0] || undefined;

  // Build product URL
  const productUrl = product.link || `https://www.${amazonDomain}/dp/${product.asin}`;

  // Extract category path
  const categoryPath = product.categories?.map(c => c.name) || [];

  // Build description from feature bullets
  const description = product.description 
    || product.feature_bullets?.join(" • ") 
    || undefined;

  // IMPORTANT: Never return empty images array if we have any image
  // Ensure at least imageUrl is in images array
  const finalImages = images.length > 0 ? images : (imageUrl ? [imageUrl] : []);

  return {
    providerProductId: product.asin,
    title: product.title,
    brand: product.brand,
    description,
    imageUrl,
    images: finalImages, // Never empty if imageUrl exists
    productUrl,
    priceUsd, // null or positive number, never 0 for missing
    currency: "USD",
    inStock: true, // Rainforest only returns in-stock items by default
    categoryPath: categoryPath.length > 0 ? categoryPath : undefined,
    rating: product.rating || null,
    reviewCount: product.ratings_total || product.reviews_total,
    raw: product as unknown as Record<string, unknown>,
  };
}

/**
 * Format product for mobile API response (stable schema)
 * CRITICAL: priceUsd is null (not 0) when unavailable
 */
export function formatCatalogItem(product: CatalogProduct): {
  id: string;
  provider: string;
  providerProductId: string;
  title: string;
  priceUsd: number | null;
  imageUrl: string | null;
  images: string[];
  productUrl: string | null;
  inStock: boolean | null;
  rating: number | null;
} {
  // Ensure priceUsd is null (not 0) when unavailable
  const priceUsd = (product.priceUsd !== undefined && product.priceUsd !== null && product.priceUsd > 0) 
    ? product.priceUsd 
    : null;

  // IMPORTANT: Never return empty images array if imageUrl exists
  const images = (product.images && product.images.length > 0) 
    ? product.images 
    : (product.imageUrl ? [product.imageUrl] : []);

  return {
    id: `rainforest:${product.providerProductId}`,
    provider: "rainforest",
    providerProductId: product.providerProductId,
    title: product.title,
    priceUsd,
    imageUrl: product.imageUrl || null,
    images, // Never empty if imageUrl exists
    productUrl: product.productUrl || null,
    inStock: product.inStock ?? null,
    rating: product.rating ?? null,
  };
}
