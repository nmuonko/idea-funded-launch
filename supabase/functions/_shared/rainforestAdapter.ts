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
  images?: { link: string }[];
  price?: {
    value: number;
    currency: string;
    raw?: string;
  };
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
    const params: RainforestSearchParams = {
      api_key: apiKey,
      type: "bestsellers",
      amazon_domain: amazonDomain,
      page,
      url: bestsellersUrl || `https://www.${amazonDomain}/Best-Sellers/zgbs`,
    };

    const url = new URL(RAINFOREST_BASE_URL);
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined) {
        url.searchParams.append(key, String(value));
      }
    });

    console.log("[CATALOG_HOME]", JSON.stringify({
      page,
      pageSize,
      type: "bestsellers",
      domain: amazonDomain,
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
      return { product: null, error: `HTTP_${response.status}` };
    }

    const data: RainforestSearchResponse = await response.json();

    if (data.error || !data.product) {
      console.log("[CATALOG_PRODUCT]", JSON.stringify({
        asin,
        status: "not_found",
        durationMs: Date.now() - startTime,
      }));
      return { product: null, error: data.error?.code || "NOT_FOUND" };
    }

    const product = normalizeProduct(data.product, amazonDomain);

    console.log("[CATALOG_PRODUCT]", JSON.stringify({
      asin,
      status: "success",
      durationMs: Date.now() - startTime,
    }));

    return { product, error: null };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error("[CATALOG_PRODUCT]", JSON.stringify({
      asin,
      status: "error",
      error: errorMsg,
    }));
    return { product: null, error: errorMsg };
  }
}

/**
 * Normalize Rainforest product to our catalog format
 */
function normalizeProduct(
  product: RainforestProduct,
  amazonDomain: string
): CatalogProduct {
  // Extract price from various fields
  const price = product.price?.value 
    || product.buybox_winner?.price?.value 
    || 0;

  const currency = product.price?.currency 
    || product.buybox_winner?.price?.currency 
    || "USD";

  // Convert non-USD prices (approximate)
  let priceUsd = price;
  if (currency !== "USD") {
    // Simple conversion for common currencies
    const conversionRates: Record<string, number> = {
      "GBP": 1.27,
      "EUR": 1.09,
      "CAD": 0.74,
      "AUD": 0.65,
      "JPY": 0.0067,
      "INR": 0.012,
    };
    priceUsd = price * (conversionRates[currency] || 1);
  }

  // Extract image URL
  const imageUrl = product.image 
    || product.images?.[0]?.link 
    || undefined;

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
    productUrl,
    priceUsd: Math.round(priceUsd * 100) / 100,
    currency: "USD",
    inStock: true, // Rainforest only returns in-stock items by default
    categoryPath: categoryPath.length > 0 ? categoryPath : undefined,
    rating: product.rating,
    reviewCount: product.ratings_total || product.reviews_total,
    raw: product as unknown as Record<string, unknown>,
  };
}

/**
 * Format product for mobile API response (stable schema)
 */
export function formatCatalogItem(product: CatalogProduct): {
  id: string;
  provider: string;
  providerProductId: string;
  title: string;
  priceUsd: number | null;
  imageUrl: string | null;
  productUrl: string | null;
  inStock: boolean | null;
  rating: number | null;
} {
  return {
    id: `rainforest:${product.providerProductId}`,
    provider: "rainforest",
    providerProductId: product.providerProductId,
    title: product.title,
    priceUsd: product.priceUsd || null,
    imageUrl: product.imageUrl || null,
    productUrl: product.productUrl || null,
    inStock: product.inStock ?? null,
    rating: product.rating || null,
  };
}
