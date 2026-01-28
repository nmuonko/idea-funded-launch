/**
 * Unified Catalog Cache Helper
 * Implements cache-first + stale-while-revalidate pattern for catalog endpoints
 * 
 * UPGRADE A: Negative caching with SHORT TTL (30s stale, 120s expire)
 * UPGRADE B: Store only NORMALIZED payloads (no raw Rainforest JSON)
 */

import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

// TTL configuration per cache type (in minutes) - POSITIVE results
export const CACHE_TTL = {
  home: { stale: 15, expire: 60 },
  search: { stale: 10, expire: 30 },
  product: { stale: 1440 * 7, expire: 1440 * 30 }, // 7 days stale, 30 days expire
  offers: { stale: 60, expire: 360 }, // 1 hour stale, 6 hours expire
} as const;

// NEGATIVE cache TTL (in seconds) - for empty/error results
export const NEGATIVE_CACHE_TTL = {
  home: { stale: 30, expire: 120 }, // 30s stale, 2min expire
  search: { stale: 30, expire: 120 },
  product: { stale: 30, expire: 120 },
  offers: { stale: 60, expire: 300 }, // 1min stale, 5min expire (longer for offers)
} as const;

// Rate limit configuration per endpoint
export const RATE_LIMITS = {
  search: { maxRequests: 30, windowMinutes: 5 },
  home: { maxRequests: 60, windowMinutes: 5 },
  product: { maxRequests: 60, windowMinutes: 10 },
  offers: { maxRequests: 30, windowMinutes: 10 },
} as const;

export type CacheType = keyof typeof CACHE_TTL;

export interface CacheEntry {
  cache_key: string;
  cache_type: string;
  provider: string | null;
  query: string | null;
  category: string | null;
  page: number | null;
  page_size: number | null;
  amazon_domain: string;
  response: any;
  stale_at: string;
  expires_at: string;
  updated_at: string;
}

export interface CacheResult {
  hit: boolean;
  stale: boolean;
  expired: boolean;
  data: any | null;
  cacheAgeSec: number;
  cacheKey: string;
  negativeCached?: boolean;
}

export interface RateLimitResult {
  allowed: boolean;
  count: number;
  limit: number;
  remaining: number;
  resetAt: string;
}

// Normalized CatalogItem schema for cache storage
export interface NormalizedCatalogItem {
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
  description?: string; // Optional, only for product details
  brand?: string; // Optional
}

// Normalized Offer schema for cache storage
export interface NormalizedOffer {
  sellerName: string | null;
  priceUsd: number | null;
  shippingUsd: number | null;
  totalUsd: number | null;
  condition: string | null;
  isPrime: boolean | null;
  isFba: boolean | null;
  deliveryText: string | null;
}

/**
 * Remove accents from string (for French normalization)
 */
export function removeAccents(str: string): string {
  return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

/**
 * Normalize query string for cache key
 */
export function normalizeQuery(q: string): string {
  return removeAccents(q.trim().toLowerCase()).replace(/\s+/g, " ");
}

/**
 * Build deterministic cache key
 */
export function buildCacheKey(
  type: CacheType,
  params: {
    env?: string;
    domain?: string;
    category?: string;
    query?: string;
    expand?: boolean;
    provider?: string;
    page?: number;
    pageSize?: number;
    productId?: string;
  }
): string {
  const domain = params.domain || "amazon.com";
  const env = params.env || "production";
  
  switch (type) {
    case "home":
      return `home:v1:domain=${domain}:env=${env}:category=${params.category || "all"}:page=${params.page || 1}:size=${params.pageSize || 20}`;
    
    case "search":
      const qNorm = params.query ? normalizeQuery(params.query) : "";
      const expand = params.expand ? 1 : 0;
      return `search:v1:domain=${domain}:env=${env}:q=${qNorm}:expand=${expand}:provider=${params.provider || "all"}:page=${params.page || 1}:size=${params.pageSize || 20}`;
    
    case "product":
      return `product:v1:domain=${domain}:env=${env}:id=${params.productId || ""}`;
    
    case "offers":
      return `offers:v1:domain=${domain}:env=${env}:id=${params.productId || ""}`;
    
    default:
      throw new Error(`Unknown cache type: ${type}`);
  }
}

/**
 * Detect if a cache response is "negative" (empty/error)
 */
export function isNegativeResult(type: CacheType, response: any): boolean {
  if (!response) return true;
  if (response.status === "error") return true;
  if (response.error) return true;
  
  switch (type) {
    case "home":
      return !response.trending || response.trending.length === 0;
    case "search":
      return !response.items || response.items.length === 0;
    case "product":
      return !response.item;
    case "offers":
      return !response.offers || response.offers.length === 0;
    default:
      return false;
  }
}

/**
 * Normalize a catalog item for minimal cache storage
 * UPGRADE B: Only store required fields
 */
export function normalizeCatalogItem(item: any): NormalizedCatalogItem {
  // Limit images to max 10
  let images: string[] = [];
  if (Array.isArray(item.images)) {
    images = item.images
      .filter((img: any) => typeof img === 'string' && img.startsWith('http'))
      .slice(0, 10);
  }
  
  // Truncate description to max 2000 chars
  let description: string | undefined;
  if (item.description && typeof item.description === 'string') {
    description = item.description.length > 2000 
      ? item.description.substring(0, 2000) + '...'
      : item.description;
  }
  
  return {
    id: item.id || '',
    provider: item.provider || 'rainforest',
    providerProductId: item.providerProductId || '',
    title: typeof item.title === 'string' ? item.title.substring(0, 500) : '',
    priceUsd: typeof item.priceUsd === 'number' && item.priceUsd > 0 ? item.priceUsd : null,
    imageUrl: item.imageUrl || null,
    images,
    productUrl: item.productUrl || null,
    inStock: typeof item.inStock === 'boolean' ? item.inStock : null,
    rating: typeof item.rating === 'number' ? item.rating : null,
    ...(description && { description }),
    ...(item.brand && { brand: item.brand }),
  };
}

/**
 * Normalize an offer for minimal cache storage
 */
export function normalizeOffer(offer: any): NormalizedOffer {
  return {
    sellerName: offer.sellerName || null,
    priceUsd: typeof offer.priceUsd === 'number' ? offer.priceUsd : null,
    shippingUsd: typeof offer.shippingUsd === 'number' ? offer.shippingUsd : null,
    totalUsd: typeof offer.totalUsd === 'number' ? offer.totalUsd : null,
    condition: offer.condition || null,
    isPrime: typeof offer.isPrime === 'boolean' ? offer.isPrime : null,
    isFba: typeof offer.isFba === 'boolean' ? offer.isFba : null,
    deliveryText: offer.delivery?.text || offer.deliveryText || null,
  };
}

/**
 * Normalize cache payload based on type
 * UPGRADE B: Strip raw provider data, keep only normalized fields
 */
export function normalizeCachePayload(type: CacheType, data: any, pageSize: number = 20): any {
  switch (type) {
    case "home":
      return {
        trending: Array.isArray(data.trending) 
          ? data.trending.slice(0, pageSize).map(normalizeCatalogItem)
          : [],
        hasMore: data.hasMore || false,
      };
    
    case "search":
      return {
        items: Array.isArray(data.items)
          ? data.items.slice(0, pageSize).map(normalizeCatalogItem)
          : [],
        total: data.total ?? null,
        usedVariantCount: data.usedVariantCount || 1,
      };
    
    case "product":
      return {
        item: data.item ? normalizeCatalogItem(data.item) : null,
      };
    
    case "offers":
      return {
        buyBox: data.buyBox ? {
          priceUsd: data.buyBox.priceUsd ?? null,
          seller: data.buyBox.seller ?? null,
          shippingUsd: data.buyBox.shippingUsd ?? null,
          condition: data.buyBox.condition ?? null,
        } : null,
        offers: Array.isArray(data.offers)
          ? data.offers.map(normalizeOffer)
          : [],
      };
    
    default:
      return data;
  }
}

/**
 * Get cache entry from database
 */
export async function getCache(
  supabase: SupabaseClient,
  cacheKey: string
): Promise<CacheResult> {
  const now = new Date();
  
  const { data: entry, error } = await supabase
    .from("catalog_cache")
    .select("*")
    .eq("cache_key", cacheKey)
    .maybeSingle();
  
  if (error || !entry) {
    return {
      hit: false,
      stale: false,
      expired: true,
      data: null,
      cacheAgeSec: 0,
      cacheKey,
    };
  }
  
  const typedEntry = entry as CacheEntry;
  const updatedAt = new Date(typedEntry.updated_at);
  const staleAt = new Date(typedEntry.stale_at);
  const expiresAt = new Date(typedEntry.expires_at);
  const cacheAgeSec = Math.floor((now.getTime() - updatedAt.getTime()) / 1000);
  
  const isStale = now > staleAt;
  const isExpired = now > expiresAt;
  
  // Check if this is a negative cached result
  const isNegative = typedEntry.response?._negativeCached === true;
  
  return {
    hit: !isExpired,
    stale: isStale,
    expired: isExpired,
    data: typedEntry.response,
    cacheAgeSec,
    cacheKey,
    negativeCached: isNegative,
  };
}

/**
 * Set cache entry in database with automatic TTL based on positive/negative result
 * UPGRADE A: Uses short TTL for negative results
 * UPGRADE B: Normalizes payload before storing
 */
export async function setCache(
  supabase: SupabaseClient,
  type: CacheType,
  cacheKey: string,
  response: any,
  metadata?: {
    provider?: string;
    query?: string;
    category?: string;
    page?: number;
    pageSize?: number;
    amazonDomain?: string;
  }
): Promise<boolean> {
  const now = new Date();
  const pageSize = metadata?.pageSize || 20;
  
  // Check if this is a negative result
  const isNegative = isNegativeResult(type, response);
  
  let staleAt: Date;
  let expiresAt: Date;
  let normalizedResponse: any;
  
  if (isNegative) {
    // UPGRADE A: Short TTL for negative results
    const ttl = NEGATIVE_CACHE_TTL[type];
    staleAt = new Date(now.getTime() + ttl.stale * 1000);
    expiresAt = new Date(now.getTime() + ttl.expire * 1000);
    // Mark as negative cache
    normalizedResponse = { ...response, _negativeCached: true };
    console.log(`[CATALOG_CACHE] Negative cache: type=${type} stale=${ttl.stale}s expire=${ttl.expire}s`);
  } else {
    // UPGRADE B: Normalize payload and use normal TTL
    const ttl = CACHE_TTL[type];
    staleAt = new Date(now.getTime() + ttl.stale * 60 * 1000);
    expiresAt = new Date(now.getTime() + ttl.expire * 60 * 1000);
    normalizedResponse = normalizeCachePayload(type, response, pageSize);
  }
  
  const cacheData = {
    cache_key: cacheKey,
    cache_type: type,
    provider: metadata?.provider || null,
    query: metadata?.query || null,
    category: metadata?.category || null,
    page: metadata?.page || null,
    page_size: metadata?.pageSize || null,
    amazon_domain: metadata?.amazonDomain || "amazon.com",
    response: normalizedResponse,
    stale_at: staleAt.toISOString(),
    expires_at: expiresAt.toISOString(),
    updated_at: now.toISOString(),
  };
  
  const { error } = await supabase
    .from("catalog_cache")
    .upsert(cacheData, { onConflict: "cache_key" });
  
  if (error) {
    console.warn("[CATALOG_CACHE] Upsert failed:", error.message);
    return false;
  }
  
  return true;
}

/**
 * Set cache with explicit short TTL (for legacy compatibility)
 * @deprecated Use setCache which auto-detects negative results
 */
export async function setCacheShort(
  supabase: SupabaseClient,
  type: CacheType,
  cacheKey: string,
  response: any,
  ttlMinutes: number = 2 // Default to 2 minutes for errors
): Promise<boolean> {
  const now = new Date();
  const staleAt = new Date(now.getTime() + 30 * 1000); // 30 seconds stale
  const expiresAt = new Date(now.getTime() + ttlMinutes * 60 * 1000);
  
  const cacheData = {
    cache_key: cacheKey,
    cache_type: type,
    provider: null,
    query: null,
    category: null,
    page: null,
    page_size: null,
    amazon_domain: "amazon.com",
    response: { ...response, _negativeCached: true },
    stale_at: staleAt.toISOString(),
    expires_at: expiresAt.toISOString(),
    updated_at: now.toISOString(),
  };
  
  const { error } = await supabase
    .from("catalog_cache")
    .upsert(cacheData, { onConflict: "cache_key" });
  
  return !error;
}

/**
 * Check rate limit for a device
 */
export async function checkRateLimit(
  supabase: SupabaseClient,
  deviceId: string,
  endpoint: CacheType
): Promise<RateLimitResult> {
  const config = RATE_LIMITS[endpoint];
  const windowMinutes = config.windowMinutes;
  const maxRequests = config.maxRequests;
  
  // Round to window start
  const now = new Date();
  const windowStart = new Date(
    Math.floor(now.getTime() / (windowMinutes * 60 * 1000)) * (windowMinutes * 60 * 1000)
  );
  const windowEnd = new Date(windowStart.getTime() + windowMinutes * 60 * 1000);
  
  // Upsert rate limit counter
  const { data, error } = await supabase
    .from("catalog_rate_limits")
    .upsert(
      {
        device_id: deviceId,
        endpoint,
        window_start: windowStart.toISOString(),
        count: 1,
      },
      { onConflict: "device_id,endpoint,window_start" }
    )
    .select("count")
    .single();
  
  if (error) {
    // On error, allow the request but log
    console.warn("[RATE_LIMIT] Error checking rate limit:", error.message);
    return {
      allowed: true,
      count: 0,
      limit: maxRequests,
      remaining: maxRequests,
      resetAt: windowEnd.toISOString(),
    };
  }
  
  // Increment count
  const currentCount = data?.count || 1;
  if (currentCount > 1) {
    await supabase
      .from("catalog_rate_limits")
      .update({ count: currentCount + 1 })
      .eq("device_id", deviceId)
      .eq("endpoint", endpoint)
      .eq("window_start", windowStart.toISOString());
  }
  
  const allowed = currentCount <= maxRequests;
  const remaining = Math.max(0, maxRequests - currentCount);
  
  return {
    allowed,
    count: currentCount,
    limit: maxRequests,
    remaining,
    resetAt: windowEnd.toISOString(),
  };
}

/**
 * Build rate limit error response
 */
export function rateLimitResponse(resetAt: string): any {
  return {
    status: "error",
    error: {
      code: "RATE_LIMIT",
      message: "Trop de requêtes, réessayez.",
      resetAt,
    },
    items: [],
    cached: false,
  };
}

/**
 * Extract device ID from request headers
 */
export function getDeviceId(req: Request): string {
  return req.headers.get("x-device-id") || 
         req.headers.get("x-afrishop-device-id") ||
         "anonymous";
}

/**
 * Add cache metadata to response
 */
export function addCacheMetadata(
  response: any,
  cacheResult: CacheResult,
  isStaging: boolean = false
): any {
  const metadata: any = {
    ...response,
    cached: cacheResult.hit,
    stale: cacheResult.stale,
    cacheAgeSec: cacheResult.cacheAgeSec,
  };
  
  // Add negativeCached flag if applicable
  if (cacheResult.negativeCached) {
    metadata.negativeCached = true;
  }
  
  // Only include debug info in staging
  if (isStaging) {
    metadata.cacheKey = cacheResult.cacheKey;
  }
  
  return metadata;
}
