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
const DEFAULT_TIMEOUT_MS = 6000; // 6 second timeout for Rainforest API

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
 * IMPORTANT: When using 'url' param, don't include amazon_domain (per Rainforest docs)
 */
export async function fetchBestsellers(
  amazonDomain: string,
  page: number = 1,
  pageSize: number = 20,
  bestsellersUrl?: string
): Promise<{ products: CatalogProduct[]; total: number; error: string | null }> {
  const apiKey = Deno.env.get("RAINFOREST_API_KEY");
  
  if (!apiKey) {
    console.error("[rainforestAdapter] No API key for bestsellers");
    return { products: [], total: 0, error: "API_KEY_MISSING" };
  }

  const startTime = Date.now();
  
  try {
    // Build URL params - note: don't combine amazon_domain with url parameter
    const url = new URL(RAINFOREST_BASE_URL);
    url.searchParams.append("api_key", apiKey);
    url.searchParams.append("type", "bestsellers");
    
    if (bestsellersUrl) {
      // When using URL, the domain is inferred from the URL itself
      url.searchParams.append("url", bestsellersUrl);
    } else {
      // When no URL provided, use domain with a default bestsellers path
      url.searchParams.append("amazon_domain", amazonDomain);
    }
    
    if (page > 1) {
      url.searchParams.append("page", String(page));
    }

    console.log("[CATALOG_HOME]", JSON.stringify({
      page,
      pageSize,
      type: "bestsellers",
      domain: amazonDomain,
      hasUrl: !!bestsellersUrl,
    }));

    const response = await fetchWithTimeout(
      url.toString(),
      { method: "GET", headers: { "Accept": "application/json" } },
      DEFAULT_TIMEOUT_MS
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error("[rainforestAdapter] Bestsellers error:", response.status, errorText);
      return { products: [], total: 0, error: `HTTP_${response.status}` };
    }

    const data: RainforestSearchResponse = await response.json();

    if (data.error) {
      console.error("[rainforestAdapter] Bestsellers API error:", data.error);
      return { products: [], total: 0, error: data.error.code || "API_ERROR" };
    }

    // Bestsellers may be in search_results or bestsellers field
    const rawProducts = data.bestsellers || data.search_results || [];
    
    const products = rawProducts
      .filter((p: RainforestProduct) => p.asin && p.title)
      .slice(0, pageSize)
      .map((p: RainforestProduct) => normalizeProduct(p, amazonDomain));

    console.log("[CATALOG_HOME]", JSON.stringify({
      page,
      pageSize,
      status: "success",
      itemCount: products.length,
      durationMs: Date.now() - startTime,
    }));

    return {
      products,
      total: data.pagination?.total_results || products.length,
      error: null,
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error("[CATALOG_HOME]", JSON.stringify({
      page,
      pageSize,
      status: "error",
      error: errorMsg,
      durationMs: Date.now() - startTime,
    }));
    return { products: [], total: 0, error: errorMsg };
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
): Promise<{ products: CatalogProduct[]; total: number; error: string | null }> {
  const apiKey = Deno.env.get("RAINFOREST_API_KEY");
  
  if (!apiKey) {
    console.error("[rainforestAdapter] No API key for search");
    return { products: [], total: 0, error: "API_KEY_MISSING" };
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
      return { products: [], total: 0, error: `HTTP_${response.status}` };
    }

    const data: RainforestSearchResponse = await response.json();

    if (data.error) {
      console.error("[rainforestAdapter] Search API error:", data.error);
      return { products: [], total: 0, error: data.error.code || "API_ERROR" };
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

    return {
      products,
      total: data.pagination?.total_results || products.length,
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
    return { products: [], total: 0, error: errorMsg };
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
 * Returns array of https URLs
 */
function extractImages(product: RainforestProduct): string[] {
  const images: string[] = [];
  
  // From images array
  if (product.images && Array.isArray(product.images)) {
    for (const img of product.images) {
      if (img.link && typeof img.link === "string") {
        const url = img.link.startsWith("http") ? img.link : `https:${img.link}`;
        if (!images.includes(url)) images.push(url);
      }
    }
  }

  // From main_image
  if (product.main_image?.link) {
    const url = product.main_image.link.startsWith("http") 
      ? product.main_image.link 
      : `https:${product.main_image.link}`;
    if (!images.includes(url)) images.unshift(url); // Main image first
  }

  // From single image field
  if (product.image && typeof product.image === "string") {
    const url = product.image.startsWith("http") ? product.image : `https:${product.image}`;
    if (!images.includes(url)) images.unshift(url);
  }

  return images;
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

  return {
    providerProductId: product.asin,
    title: product.title,
    brand: product.brand,
    description,
    imageUrl,
    images, // Include images array
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

  return {
    id: `rainforest:${product.providerProductId}`,
    provider: "rainforest",
    providerProductId: product.providerProductId,
    title: product.title,
    priceUsd,
    imageUrl: product.imageUrl || null,
    images: product.images || [],
    productUrl: product.productUrl || null,
    inStock: product.inStock ?? null,
    rating: product.rating ?? null,
  };
}
