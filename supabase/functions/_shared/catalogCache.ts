/**
 * Unified Catalog Cache Helper
 * Implements cache-first + stale-while-revalidate pattern for catalog endpoints
 */

import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

// TTL configuration per cache type (in minutes)
export const CACHE_TTL = {
  home: { stale: 15, expire: 60 },
  search: { stale: 10, expire: 30 },
  product: { stale: 1440, expire: 10080 }, // 1 day stale, 7 days expire
  offers: { stale: 60, expire: 360 }, // 1 hour stale, 6 hours expire
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
}

export interface RateLimitResult {
  allowed: boolean;
  count: number;
  limit: number;
  remaining: number;
  resetAt: string;
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
  
  return {
    hit: !isExpired,
    stale: isStale,
    expired: isExpired,
    data: typedEntry.response,
    cacheAgeSec,
    cacheKey,
  };
}

/**
 * Set cache entry in database
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
  const ttl = CACHE_TTL[type];
  
  const staleAt = new Date(now.getTime() + ttl.stale * 60 * 1000);
  const expiresAt = new Date(now.getTime() + ttl.expire * 60 * 1000);
  
  const cacheData = {
    cache_key: cacheKey,
    cache_type: type,
    provider: metadata?.provider || null,
    query: metadata?.query || null,
    category: metadata?.category || null,
    page: metadata?.page || null,
    page_size: metadata?.pageSize || null,
    amazon_domain: metadata?.amazonDomain || "amazon.com",
    response,
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
 * Set cache with short TTL for error/empty responses
 */
export async function setCacheShort(
  supabase: SupabaseClient,
  type: CacheType,
  cacheKey: string,
  response: any,
  ttlMinutes: number = 5
): Promise<boolean> {
  const now = new Date();
  const staleAt = new Date(now.getTime() + ttlMinutes * 60 * 1000);
  const expiresAt = new Date(now.getTime() + ttlMinutes * 2 * 60 * 1000);
  
  const cacheData = {
    cache_key: cacheKey,
    cache_type: type,
    provider: null,
    query: null,
    category: null,
    page: null,
    page_size: null,
    amazon_domain: "amazon.com",
    response,
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
  
  // Only include debug info in staging
  if (isStaging) {
    metadata.cacheKey = cacheResult.cacheKey;
  }
  
  return metadata;
}
