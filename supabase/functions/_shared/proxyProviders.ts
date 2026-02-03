/**
 * Market Search Proxy - Provider Adapters
 * Normalized interfaces for eBay and Amazon search results
 */

import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { searchEbay } from "./ebayAdapter.ts";
import { searchRainforest } from "./rainforestAdapter.ts";

// ─── Types ───────────────────────────────────────────────────────────────────

export type SourceType = "ebay" | "amazon" | "both";
export type ConditionType = "new" | "used" | "refurbished" | "any";
export type SortType = "best" | "price_asc" | "price_desc" | "newly_listed";

export interface NormalizedItem {
  source: "ebay" | "amazon";
  externalId: string;
  title: string;
  price: number;
  currency: string;
  imageUrl: string | null;
  itemUrl: string;
  condition: "new" | "used" | "refurbished" | "unknown";
  shippingPrice: number;
  sellerName: string | null;
  location: string | null;
  raw: Record<string, unknown>;
}

export interface SearchParams {
  q: string;
  minPrice?: number;
  maxPrice?: number;
  condition: ConditionType;
  sort: SortType;
  limit: number;
  page: number;
  currency: string;
  country: string;
  category?: string;
}

export interface ProviderResult {
  items: NormalizedItem[];
  total: number;
  hasMore: boolean;
  durationMs: number;
  error: string | null;
}

// ─── eBay Mappings ───────────────────────────────────────────────────────────

// Map our sort values to eBay filter strings
function getEbayFilter(params: SearchParams): string {
  const filters: string[] = ["buyingOptions:{FIXED_PRICE}"];
  
  // Condition mapping
  const conditionMap: Record<ConditionType, string> = {
    new: "1000",
    used: "3000",
    refurbished: "2000|2500",
    any: "1000|1500|2000|2500|3000",
  };
  filters.push(`conditionIds:{${conditionMap[params.condition]}}`);
  
  // Price filter
  if (params.minPrice !== undefined || params.maxPrice !== undefined) {
    const min = params.minPrice ?? 0;
    const max = params.maxPrice ?? 999999;
    filters.push(`price:[${min}..${max}],priceCurrency:${params.currency}`);
  }
  
  return filters.join(",");
}

// Normalize eBay condition ID to our enum
function normalizeEbayCondition(item: unknown): NormalizedItem["condition"] {
  const ebayItem = item as Record<string, unknown>;
  const conditionId = ebayItem.conditionId as string | undefined;
  
  if (!conditionId) return "unknown";
  
  if (conditionId === "1000") return "new";
  if (conditionId === "3000") return "used";
  if (conditionId === "2000" || conditionId === "2500") return "refurbished";
  
  return "unknown";
}

/**
 * Search eBay with normalized output
 */
export async function searchEbayNormalized(
  supabase: SupabaseClient,
  params: SearchParams
): Promise<ProviderResult> {
  const startTime = Date.now();
  
  try {
    const filter = getEbayFilter(params);
    
    const result = await searchEbay(
      supabase,
      params.q,
      params.page,
      params.limit,
      {
        marketplace: getEbayMarketplace(params.country),
        filter,
        environment: "production",
        searchLimit: params.limit,
      }
    );
    
    const durationMs = Date.now() - startTime;
    
    if (result.debug.error) {
      console.log("[SEARCH_PROXY] ebay_err", JSON.stringify({
        error: result.debug.error.slice(0, 100),
        durationMs,
      }));
      return {
        items: [],
        total: 0,
        hasMore: false,
        durationMs,
        error: "eBay search temporarily unavailable",
      };
    }
    
    // Normalize items
    const items: NormalizedItem[] = result.items.map(item => ({
      source: "ebay" as const,
      externalId: item.providerProductId,
      title: item.title,
      price: item.priceUsd ?? 0,
      currency: item.currency || params.currency,
      imageUrl: item.imageUrl,
      itemUrl: item.productUrl,
      condition: normalizeEbayCondition(item),
      shippingPrice: 0, // eBay doesn't include shipping in search results
      sellerName: null, // Not available in search results
      location: null, // Not available in search results
      raw: {}, // Keep response small
    }));
    
    console.log("[SEARCH_PROXY] ebay_ok", JSON.stringify({
      items: items.length,
      durationMs,
    }));
    
    return {
      items,
      total: result.total,
      hasMore: result.hasMore,
      durationMs,
      error: null,
    };
  } catch (err) {
    const durationMs = Date.now() - startTime;
    const errorMsg = err instanceof Error ? err.message : String(err);
    
    console.log("[SEARCH_PROXY] ebay_err", JSON.stringify({
      error: errorMsg.slice(0, 100),
      durationMs,
    }));
    
    return {
      items: [],
      total: 0,
      hasMore: false,
      durationMs,
      error: "eBay search temporarily unavailable",
    };
  }
}

// ─── Amazon Mappings ─────────────────────────────────────────────────────────

/**
 * Search Amazon (via Rainforest) with normalized output
 */
export async function searchAmazonNormalized(
  params: SearchParams
): Promise<ProviderResult> {
  const startTime = Date.now();
  
  try {
    // Use Rainforest adapter
    const result = await searchRainforest(
      params.q,
      params.page,
      params.limit,
      getAmazonDomain(params.country),
      getSortForRainforest(params.sort),
      {
        minPrice: params.minPrice,
        maxPrice: params.maxPrice,
        condition: params.condition === "any" ? undefined : params.condition,
      }
    );
    
    const durationMs = Date.now() - startTime;
    
    if (result.error) {
      console.log("[SEARCH_PROXY] amazon_err", JSON.stringify({
        error: result.error.slice(0, 100),
        durationMs,
      }));
      return {
        items: [],
        total: 0,
        hasMore: false,
        durationMs,
        error: "Amazon search temporarily unavailable",
      };
    }
    
    // Normalize items
    const items: NormalizedItem[] = result.products.map(product => ({
      source: "amazon" as const,
      externalId: product.providerProductId,
      title: product.title,
      price: product.priceUsd ?? 0,
      currency: product.currency || params.currency,
      imageUrl: product.imageUrl,
      itemUrl: product.productUrl,
      condition: normalizeAmazonCondition(product),
      shippingPrice: 0,
      sellerName: null,
      location: null,
      raw: {},
    }));
    
    console.log("[SEARCH_PROXY] amazon_ok", JSON.stringify({
      items: items.length,
      durationMs,
    }));
    
    return {
      items,
      total: result.total,
      hasMore: result.hasMore,
      durationMs,
      error: null,
    };
  } catch (err) {
    const durationMs = Date.now() - startTime;
    const errorMsg = err instanceof Error ? err.message : String(err);
    
    console.log("[SEARCH_PROXY] amazon_err", JSON.stringify({
      error: errorMsg.slice(0, 100),
      durationMs,
    }));
    
    return {
      items: [],
      total: 0,
      hasMore: false,
      durationMs,
      error: "Amazon search temporarily unavailable",
    };
  }
}

// ─── Helper Functions ────────────────────────────────────────────────────────

function getEbayMarketplace(country: string): string {
  const marketplaces: Record<string, string> = {
    US: "EBAY_US",
    UK: "EBAY_GB",
    GB: "EBAY_GB",
    DE: "EBAY_DE",
    FR: "EBAY_FR",
    CA: "EBAY_CA",
    AU: "EBAY_AU",
  };
  return marketplaces[country.toUpperCase()] || "EBAY_US";
}

function getAmazonDomain(country: string): string {
  const domains: Record<string, string> = {
    US: "amazon.com",
    UK: "amazon.co.uk",
    GB: "amazon.co.uk",
    DE: "amazon.de",
    FR: "amazon.fr",
    CA: "amazon.ca",
    AU: "amazon.com.au",
  };
  return domains[country.toUpperCase()] || "amazon.com";
}

function getSortForRainforest(sort: SortType): "relevance" | "price_asc" | "price_desc" | "newest" {
  const sortMap: Record<SortType, "relevance" | "price_asc" | "price_desc" | "newest"> = {
    best: "relevance",
    price_asc: "price_asc",
    price_desc: "price_desc",
    newly_listed: "newest",
  };
  return sortMap[sort];
}

function normalizeAmazonCondition(product: unknown): NormalizedItem["condition"] {
  // Amazon products from Rainforest are typically new unless specified
  // The condition field isn't always present in search results
  return "new";
}
