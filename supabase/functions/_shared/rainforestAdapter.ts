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

interface RainforestSearchParams {
  api_key: string;
  type: "search" | "product" | "category";
  amazon_domain: string;
  search_term?: string;
  asin?: string;
  category_id?: string;
  page?: number;
  sort_by?: string;
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
 * Create a Rainforest adapter for Amazon
 */
export function createRainforestAdapter(
  config: ProviderConfig,
  _env: EnvironmentConfig | null
): ProviderAdapter {
  const apiKey = Deno.env.get("RAINFOREST_API_KEY");
  const amazonDomain = (config.config.amazon_domain as string) || "amazon.com";
  
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

        console.log("[RAINFOREST_DEBUG]", JSON.stringify({
          action: "search_request",
          query,
          page,
          domain: amazonDomain,
        }));

        const response = await fetch(url.toString(), {
          method: "GET",
          headers: { "Accept": "application/json" },
        });

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

        console.log("[RAINFOREST_DEBUG]", JSON.stringify({
          action: "search_response",
          query,
          page,
          rawCount: data.search_results?.length || 0,
          filteredCount: filteredProducts.length,
          totalResults: data.pagination?.total_results || filteredProducts.length,
          creditsUsed: data.request_info?.credits_used,
          creditsRemaining: data.request_info?.credits_remaining,
          durationMs: Date.now() - startTime,
        }));

        return {
          products: filteredProducts,
          totalResults: data.pagination?.total_results || filteredProducts.length,
          page,
          pageSize: 20,
          hasMore: (data.pagination?.current_page || 1) < (data.pagination?.total_pages || 1),
        };
      } catch (err) {
        console.error("[rainforestAdapter] Search error:", err);
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

        console.log("[RAINFOREST_DEBUG]", JSON.stringify({
          action: "product_request",
          asin,
        }));

        const response = await fetch(url.toString(), {
          method: "GET",
          headers: { "Accept": "application/json" },
        });

        if (!response.ok) {
          throw new Error(`Rainforest API error: ${response.status}`);
        }

        const data: RainforestSearchResponse = await response.json();

        if (data.error || !data.product) {
          console.error("[rainforestAdapter] Product not found:", asin);
          return null;
        }

        console.log("[RAINFOREST_DEBUG]", JSON.stringify({
          action: "product_response",
          asin,
          found: true,
          creditsUsed: data.request_info?.credits_used,
        }));

        return normalizeProduct(data.product, amazonDomain);
      } catch (err) {
        console.error("[rainforestAdapter] getProduct error:", err);
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
