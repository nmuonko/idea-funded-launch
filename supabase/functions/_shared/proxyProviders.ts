/**
 * Market Search Proxy - Provider Adapters
 * Normalized interfaces for eBay and Amazon search results
 */

import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { searchEbay, getEbayItem } from "./ebayAdapter.ts";
import { searchRainforest } from "./rainforestAdapter.ts";

// Rainforest API base URL
const RAINFOREST_BASE_URL = "https://api.rainforestapi.com/request";
const RAINFOREST_TIMEOUT_MS = 15000;

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

// Extended item detail with ALL images
export interface NormalizedItemDetail {
  source: "ebay" | "amazon";
  externalId: string;
  title: string;
  price: number;
  currency: string;
  imageUrl: string | null;
  imageUrls: string[];
  itemUrl: string;
  condition: "new" | "used" | "refurbished" | "unknown";
  shippingPrice: number;
  sellerName: string | null;
  location: string | null;
  description: string | null;
  attributes: Record<string, string>;
  inStock: boolean;
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

export interface ItemDetailResult {
  item: NormalizedItemDetail | null;
  durationMs: number;
  error: string | null;
}

// Maximum images to return
const MAX_IMAGES = 20;

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

/**
 * Get eBay item details with ALL images
 */
export async function getEbayItemNormalized(
  supabase: SupabaseClient,
  itemId: string
): Promise<ItemDetailResult> {
  const startTime = Date.now();
  
  try {
    const result = await getEbayItem(supabase, itemId);
    const durationMs = Date.now() - startTime;
    
    if (!result.item || result.debug.error) {
      return {
        item: null,
        durationMs,
        error: result.debug.error || "Item not found",
      };
    }
    
    const ebayItem = result.item;
    
    // Extract ALL images from eBay response
    // The ebayAdapter.getEbayItem already uses extractDetailImagesAsync
    // which returns all images (primary + additionalImages + scraped if enabled)
    const allImages = ebayItem.images || [];
    
    // Validate and dedupe images
    const validImageUrls = dedupeAndValidateImages(allImages, MAX_IMAGES);
    
    const normalizedItem: NormalizedItemDetail = {
      source: "ebay",
      externalId: ebayItem.providerProductId,
      title: ebayItem.title,
      price: ebayItem.priceUsd ?? 0,
      currency: ebayItem.currency || "USD",
      imageUrl: validImageUrls[0] || null,
      imageUrls: validImageUrls,
      itemUrl: ebayItem.productUrl,
      condition: normalizeEbayConditionFromString(ebayItem.attributes?.Condition),
      shippingPrice: 0,
      sellerName: null,
      location: null,
      description: ebayItem.description || null,
      attributes: ebayItem.attributes || {},
      inStock: ebayItem.inStock ?? true,
    };
    
    return {
      item: normalizedItem,
      durationMs,
      error: null,
    };
  } catch (err) {
    const durationMs = Date.now() - startTime;
    const errorMsg = err instanceof Error ? err.message : String(err);
    
    return {
      item: null,
      durationMs,
      error: errorMsg.slice(0, 100),
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

/**
 * Get Amazon item details with ALL images
 * Directly calls Rainforest API for product details
 */
export async function getAmazonItemNormalized(
  asin: string,
  amazonDomain: string = "amazon.com"
): Promise<ItemDetailResult> {
  const startTime = Date.now();
  const apiKey = Deno.env.get("RAINFOREST_API_KEY");
  
  if (!apiKey) {
    return {
      item: null,
      durationMs: Date.now() - startTime,
      error: "Rainforest API key not configured",
    };
  }
  
  try {
    // Build Rainforest product request URL
    const url = new URL(RAINFOREST_BASE_URL);
    url.searchParams.append("api_key", apiKey);
    url.searchParams.append("type", "product");
    url.searchParams.append("amazon_domain", amazonDomain);
    url.searchParams.append("asin", asin);
    
    // Use AbortController for timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), RAINFOREST_TIMEOUT_MS);
    
    const response = await fetch(url.toString(), {
      method: "GET",
      headers: { "Accept": "application/json" },
      signal: controller.signal,
    });
    
    clearTimeout(timeoutId);
    
    const durationMs = Date.now() - startTime;
    
    if (!response.ok) {
      return {
        item: null,
        durationMs,
        error: `Rainforest API error: ${response.status}`,
      };
    }
    
    const data = await response.json();
    
    if (data.error || !data.product) {
      return {
        item: null,
        durationMs,
        error: data.error?.message || "Product not found",
      };
    }
    
    const product = data.product;
    
    // Extract ALL images from Rainforest response
    const allImages = extractAmazonImagesFromRawProduct(product);
    
    // Validate and dedupe images
    const validImageUrls = dedupeAndValidateImages(allImages, MAX_IMAGES);
    
    // Extract price
    const price = product.buybox_winner?.price?.value 
      || product.price?.value 
      || product.current_price?.value 
      || 0;
    
    const currency = product.buybox_winner?.price?.currency 
      || product.price?.currency 
      || product.current_price?.currency 
      || "USD";
    
    // Extract description from feature_bullets or description
    const description = product.feature_bullets?.join("\n") 
      || product.description 
      || null;
    
    const normalizedItem: NormalizedItemDetail = {
      source: "amazon",
      externalId: product.asin || asin,
      title: product.title || "Unknown",
      price,
      currency,
      imageUrl: validImageUrls[0] || null,
      imageUrls: validImageUrls,
      itemUrl: product.link || `https://www.${amazonDomain}/dp/${asin}`,
      condition: "new",
      shippingPrice: 0,
      sellerName: product.buybox_winner?.fulfillment?.type || null,
      location: null,
      description,
      attributes: extractAmazonAttributesFromProduct(product),
      inStock: product.buybox_winner?.availability?.raw !== "Out of Stock",
    };
    
    return {
      item: normalizedItem,
      durationMs,
      error: null,
    };
  } catch (err) {
    const durationMs = Date.now() - startTime;
    const errorMsg = err instanceof Error ? err.message : String(err);
    
    // Handle abort/timeout specifically
    if (errorMsg.includes("aborted")) {
      return {
        item: null,
        durationMs,
        error: "Request timeout",
      };
    }
    
    return {
      item: null,
      durationMs,
      error: errorMsg.slice(0, 100),
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

function normalizeEbayConditionFromString(condition?: string): NormalizedItemDetail["condition"] {
  if (!condition) return "unknown";
  
  const lower = condition.toLowerCase();
  if (lower.includes("new")) return "new";
  if (lower.includes("used") || lower.includes("pre-owned")) return "used";
  if (lower.includes("refurbished") || lower.includes("certified")) return "refurbished";
  
  return "unknown";
}

/**
 * Extract ALL images from a raw Rainforest API product response
 * This handles the direct API response structure
 */
// deno-lint-ignore no-explicit-any
function extractAmazonImagesFromRawProduct(product: any): string[] {
  const images: string[] = [];
  
  // main_image field (Rainforest format - highest priority)
  if (product.main_image?.link) {
    images.push(upgradeAmazonImage(product.main_image.link));
  }
  
  // images array (Rainforest format - all product images)
  if (Array.isArray(product.images)) {
    for (const img of product.images) {
      if (img.link) {
        images.push(upgradeAmazonImage(img.link));
      }
    }
  }
  
  // Fallback to simple image field
  if (product.image && typeof product.image === "string") {
    images.push(upgradeAmazonImage(product.image));
  }
  
  // Also check variants if present (some products have variant images)
  if (Array.isArray(product.variants)) {
    for (const variant of product.variants) {
      if (variant.main_image?.link) {
        images.push(upgradeAmazonImage(variant.main_image.link));
      }
    }
  }
  
  return images;
}

/**
 * Extract attributes from a raw Rainforest API product response
 */
// deno-lint-ignore no-explicit-any
function extractAmazonAttributesFromProduct(product: any): Record<string, string> {
  const attributes: Record<string, string> = {};
  
  // Brand
  if (product.brand) {
    attributes["Brand"] = product.brand;
  }
  
  // Manufacturer
  if (product.manufacturer) {
    attributes["Manufacturer"] = product.manufacturer;
  }
  
  // Specifications from specifications array
  if (Array.isArray(product.specifications)) {
    for (const spec of product.specifications) {
      if (spec.name && spec.value) {
        attributes[spec.name] = spec.value;
      }
    }
  }
  
  // Product details from product_details
  if (Array.isArray(product.product_details)) {
    for (const detail of product.product_details) {
      if (detail.name && detail.value) {
        attributes[detail.name] = detail.value;
      }
    }
  }
  
  return attributes;
}

/**
 * Extract ALL images from a Rainforest/Amazon product response (CatalogProduct format)
 */
function extractAmazonImages(product: Record<string, unknown>): string[] {
  const images: string[] = [];
  
  // Main image (primary)
  if (product.imageUrl && typeof product.imageUrl === "string") {
    images.push(upgradeAmazonImage(product.imageUrl));
  }
  
  // main_image field (Rainforest format)
  const mainImage = product.main_image as { link?: string } | undefined;
  if (mainImage?.link) {
    images.push(upgradeAmazonImage(mainImage.link));
  }
  
  // images array (Rainforest format)
  const imagesArray = product.images as { link?: string }[] | undefined;
  if (Array.isArray(imagesArray)) {
    for (const img of imagesArray) {
      if (img.link) {
        images.push(upgradeAmazonImage(img.link));
      }
    }
  }
  
  // raw.images (if available from raw response)
  const raw = product.raw as Record<string, unknown> | undefined;
  if (raw?.images && Array.isArray(raw.images)) {
    for (const img of raw.images as { link?: string }[]) {
      if (img.link) {
        images.push(upgradeAmazonImage(img.link));
      }
    }
  }
  
  // raw.main_image
  if (raw?.main_image) {
    const rawMainImage = raw.main_image as { link?: string };
    if (rawMainImage.link) {
      images.push(upgradeAmazonImage(rawMainImage.link));
    }
  }
  
  return images;
}

/**
 * Upgrade Amazon image URL to highest resolution
 * Replace size indicators like _SL200_ with _SL1500_
 */
function upgradeAmazonImage(url: string): string {
  if (!url) return url;
  
  // Common Amazon image size patterns
  // _SL{n}_ -> _SL1500_
  // _SS{n}_ -> _SL1500_
  // _AC_SX{n}_ -> _AC_SL1500_
  // _AC_SY{n}_ -> _AC_SL1500_
  
  return url
    .replace(/_S[LXYS]\d+_/gi, "_SL1500_")
    .replace(/_AC_S[XY]\d+_/gi, "_AC_SL1500_")
    .replace(/\._[A-Z]+\d+_\./i, "._SL1500_.");
}

/**
 * Deduplicate and validate image URLs
 * - Removes duplicates
 * - Removes non-https URLs
 * - Limits to maxCount
 */
function dedupeAndValidateImages(urls: string[], maxCount: number): string[] {
  const seen = new Set<string>();
  const valid: string[] = [];
  
  for (const url of urls) {
    // Skip empty or non-https URLs
    if (!url || typeof url !== "string" || !url.startsWith("https://")) {
      continue;
    }
    
    // Deduplicate
    if (seen.has(url)) {
      continue;
    }
    
    seen.add(url);
    valid.push(url);
    
    // Respect max limit
    if (valid.length >= maxCount) {
      break;
    }
  }
  
  return valid;
}
