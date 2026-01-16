/**
 * In-Memory Response Cache for High-Traffic Endpoints
 * 
 * Optimized for 10K+ simultaneous users with:
 * - Configurable TTL per cache key
 * - Automatic stale-while-revalidate
 * - Request coalescing to prevent thundering herd
 * - Memory-efficient LRU eviction
 */

interface CacheEntry<T> {
  data: T;
  createdAt: number;
  ttlMs: number;
}

interface CoalesceEntry<T> {
  promise: Promise<T>;
  createdAt: number;
}

// In-memory cache storage
const responseCache = new Map<string, CacheEntry<any>>();
const inFlightRequests = new Map<string, CoalesceEntry<any>>();

// Cache configuration
const MAX_CACHE_SIZE = 1000;
const COALESCE_TIMEOUT_MS = 30_000; // 30 seconds max for in-flight

// Default TTLs for different endpoint types
// INSTANT for admin config - changes reflect immediately
export const CACHE_TTL = {
  PUBLIC_CONFIG: 0,                  // No cache - instant updates
  SHIPPING_TYPES: 5 * 60 * 1000,     // 5 minutes - rarely changes
  SHIPPING_CONFIG: 5 * 60 * 1000,    // 5 minutes - rarely changes
  USER_CART: 30 * 1000,              // 30 seconds - frequently changes
  PRODUCT_INFO: 60 * 1000,           // 1 minute - moderate
  SETTINGS: 0,                       // No cache - instant updates
} as const;

/**
 * Get cached response if valid
 */
export function getCached<T>(key: string): T | null {
  const entry = responseCache.get(key);
  
  if (!entry) {
    return null;
  }
  
  const age = Date.now() - entry.createdAt;
  
  // Check if still fresh
  if (age < entry.ttlMs) {
    return entry.data as T;
  }
  
  // Stale - remove and return null
  responseCache.delete(key);
  return null;
}

/**
 * Get cached response, allowing stale data
 * Returns { data, isStale } or null if no cache
 */
export function getCachedWithStale<T>(key: string, maxStaleMs: number = 60_000): { data: T; isStale: boolean } | null {
  const entry = responseCache.get(key);
  
  if (!entry) {
    return null;
  }
  
  const age = Date.now() - entry.createdAt;
  
  // Fresh
  if (age < entry.ttlMs) {
    return { data: entry.data as T, isStale: false };
  }
  
  // Stale but within acceptable range
  if (age < entry.ttlMs + maxStaleMs) {
    return { data: entry.data as T, isStale: true };
  }
  
  // Too stale - remove
  responseCache.delete(key);
  return null;
}

/**
 * Store response in cache
 */
export function setCache<T>(key: string, data: T, ttlMs: number): void {
  // LRU eviction if at capacity
  if (responseCache.size >= MAX_CACHE_SIZE) {
    const oldestKey = responseCache.keys().next().value;
    if (oldestKey) {
      responseCache.delete(oldestKey);
    }
  }
  
  responseCache.set(key, {
    data,
    createdAt: Date.now(),
    ttlMs,
  });
}

/**
 * Invalidate specific cache key
 */
export function invalidateCache(key: string): void {
  responseCache.delete(key);
}

/**
 * Invalidate all cache keys matching a prefix
 */
export function invalidateCacheByPrefix(prefix: string): void {
  for (const key of responseCache.keys()) {
    if (key.startsWith(prefix)) {
      responseCache.delete(key);
    }
  }
}

/**
 * Clear entire cache
 */
export function clearCache(): void {
  responseCache.clear();
}

/**
 * Request Coalescing - prevents thundering herd problem
 * 
 * When multiple identical requests come in simultaneously,
 * only one actually executes, others wait for its result.
 */
export async function coalesce<T>(
  key: string,
  fetchFn: () => Promise<T>,
  cacheTtlMs?: number
): Promise<T> {
  // Check cache first
  const cached = getCached<T>(key);
  if (cached !== null) {
    return cached;
  }
  
  // Check if request already in flight
  const existing = inFlightRequests.get(key);
  if (existing) {
    // Check if in-flight request is too old (stuck)
    if (Date.now() - existing.createdAt < COALESCE_TIMEOUT_MS) {
      return existing.promise;
    }
    // Too old, clean up and proceed
    inFlightRequests.delete(key);
  }
  
  // Execute the fetch
  const promise = fetchFn()
    .then((result) => {
      // Cache the result if TTL provided
      if (cacheTtlMs) {
        setCache(key, result, cacheTtlMs);
      }
      return result;
    })
    .finally(() => {
      inFlightRequests.delete(key);
    });
  
  inFlightRequests.set(key, {
    promise,
    createdAt: Date.now(),
  });
  
  return promise;
}

/**
 * Stale-While-Revalidate pattern
 * 
 * Returns stale data immediately while refreshing in background.
 * Best for data that can tolerate slight staleness.
 */
export async function staleWhileRevalidate<T>(
  key: string,
  fetchFn: () => Promise<T>,
  ttlMs: number,
  maxStaleTtlMs: number = 60_000
): Promise<T> {
  const cached = getCachedWithStale<T>(key, maxStaleTtlMs);
  
  if (cached) {
    if (cached.isStale) {
      // Return stale data but refresh in background
      coalesce(key, fetchFn, ttlMs).catch((err) => {
        console.error(`[responseCache] Background refresh failed for ${key}:`, err);
      });
    }
    return cached.data;
  }
  
  // No cache at all, must fetch
  return coalesce(key, fetchFn, ttlMs);
}

/**
 * Get cache statistics for monitoring
 */
export function getCacheStats(): {
  size: number;
  maxSize: number;
  inFlightCount: number;
} {
  return {
    size: responseCache.size,
    maxSize: MAX_CACHE_SIZE,
    inFlightCount: inFlightRequests.size,
  };
}

/**
 * Generate a cache key from endpoint + params
 */
export function makeCacheKey(endpoint: string, params?: Record<string, any>): string {
  if (!params || Object.keys(params).length === 0) {
    return endpoint;
  }
  const sortedParams = Object.keys(params)
    .sort()
    .map(k => `${k}=${params[k]}`)
    .join('&');
  return `${endpoint}?${sortedParams}`;
}
