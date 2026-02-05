/**
 * Client-side catalog cache for web
 * Respects backend TTL and works across users for public catalog data
 */

const CACHE_PREFIX = 'afrishop_cache:v3:';
const DEFAULT_TTL_SECONDS = 3600; // 1 hour fallback

interface CacheEntry<T> {
  value: T;
  cachedAt: number;
  ttlSeconds: number;
  expiresAt: number;
}

/**
 * Remove accents/diacritics from text for consistent cache keys
 * e.g., "téléphone" → "telephone", "café" → "cafe"
 */
function removeAccents(str: string): string {
  return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/**
 * Generate a stable cache key from parameters
 * Normalizes queries to maximize cache hits (accents, case, whitespace)
 */
export function generateCacheKey(endpoint: string, params: Record<string, any>): string {
  // Normalize and sort params for consistent keys
  const normalized: Record<string, string> = {};
  
  Object.keys(params).sort().forEach(key => {
    let value = params[key];
    if (value === undefined || value === null || value === '') return;
    
    // Normalize string values - remove accents, lowercase, collapse whitespace
    if (typeof value === 'string') {
      value = removeAccents(value.trim().toLowerCase().replace(/\s+/g, ' '));
    }
    
    normalized[key] = String(value);
  });
  
  const paramString = Object.entries(normalized)
    .map(([k, v]) => `${k}=${v}`)
    .join('&');
    
  return `${CACHE_PREFIX}${endpoint}:${paramString}`;
}

/**
 * Get cached data if not expired (synchronous for instant UI)
 */
export function getCached<T>(key: string): { data: T; expiresIn: number } | null {
  try {
    const stored = localStorage.getItem(key);
    if (!stored) return null;
    
    const entry = JSON.parse(stored) as CacheEntry<T>;
    const now = Date.now();
    
    if (now >= entry.expiresAt) {
      // Don't log on every expired check - too noisy
      localStorage.removeItem(key);
      return null;
    }
    
    const expiresIn = Math.round((entry.expiresAt - now) / 1000);
    // Only log cache hits for debugging
    if (expiresIn > 0) {
      console.log('[CACHE] HIT key=', key.substring(0, 60), 'expiresIn=', expiresIn, 's');
    }
    return { data: entry.value, expiresIn };
  } catch (e) {
    // Silently handle parse errors
    return null;
  }
}

/**
 * Store data in cache with TTL
 */
export function setCache<T>(key: string, data: T, ttlSeconds: number): void {
  try {
    const now = Date.now();
    const entry: CacheEntry<T> = {
      value: data,
      cachedAt: now,
      ttlSeconds,
      expiresAt: now + ttlSeconds * 1000,
    };
    
    localStorage.setItem(key, JSON.stringify(entry));
    console.log('[CACHE] STORE key=', key, 'ttlSeconds=', ttlSeconds);
  } catch (e) {
    // localStorage might be full - try to clear old cache entries
    console.error('[CACHE] Error storing cache:', e);
    clearExpiredCache();
  }
}

/**
 * Parse TTL from Cache-Control header or response body
 */
export function parseTtlFromResponse(response: Response, data: any): number {
  // Try Cache-Control header first
  const cacheControl = response.headers.get('Cache-Control');
  if (cacheControl) {
    const maxAgeMatch = cacheControl.match(/max-age=(\d+)/);
    if (maxAgeMatch) {
      const ttl = parseInt(maxAgeMatch[1], 10);
      console.log('[CACHE] ttlSecondsUsed=', ttl, '(from Cache-Control)');
      return ttl;
    }
  }
  
  // Try response body for ttlSeconds or ttl field
  if (data?.ttlSeconds) {
    console.log('[CACHE] ttlSecondsUsed=', data.ttlSeconds, '(from response body)');
    return data.ttlSeconds;
  }
  if (data?.ttl) {
    console.log('[CACHE] ttlSecondsUsed=', data.ttl, '(from response body)');
    return data.ttl;
  }
  
  console.log('[CACHE] ttlSecondsUsed=', DEFAULT_TTL_SECONDS, '(default fallback)');
  return DEFAULT_TTL_SECONDS;
}

/**
 * Clear all expired cache entries
 */
export function clearExpiredCache(): void {
  const now = Date.now();
  const keysToRemove: string[] = [];
  
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith(CACHE_PREFIX)) {
      try {
        const stored = localStorage.getItem(key);
        if (stored) {
          const entry = JSON.parse(stored) as CacheEntry<any>;
          if (now >= entry.expiresAt) {
            keysToRemove.push(key);
          }
        }
      } catch (e) {
        keysToRemove.push(key!);
      }
    }
  }
  
  keysToRemove.forEach(key => localStorage.removeItem(key));
  if (keysToRemove.length > 0) {
    console.log('[CACHE] cleared', keysToRemove.length, 'expired entries');
  }
}

/**
 * Get current rotation key (matches backend homeRotation.ts)
 * Format: YYYY-MM-DD-bN where N is bucket (0 or 1 for 12h rotation)
 */
function getCurrentRotationKey(): string {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  const day = String(now.getUTCDate()).padStart(2, '0');
  const hour = now.getUTCHours();
  const bucketIndex = Math.floor(hour / 12); // 0 or 1 for 12h buckets
  return `${year}-${month}-${day}-b${bucketIndex}`;
}

/**
 * Cached fetch for catalog endpoints
 * Uses public API key only (no auth) for shared caching
 * Returns cached data synchronously when available for instant UI
 * 
 * For catalog-home specifically, uses rotation key to ensure
 * all platforms see the same content per rotation period.
 */
export async function cachedCatalogFetch<T>(
  endpoint: string,
  params: Record<string, any> = {},
  options: { skipCache?: boolean } = {}
): Promise<T> {
  // For catalog-home, include rotation key in cache key for cross-platform consistency
  const isHomeEndpoint = endpoint === 'catalog-home';
  const rotationKey = isHomeEndpoint ? getCurrentRotationKey() : null;
  
  const cacheKeyParams = rotationKey 
    ? { ...params, _rotation: rotationKey }
    : params;
  const cacheKey = generateCacheKey(endpoint, cacheKeyParams);
  
  // Check cache first (unless skipping) - this is synchronous and fast
  if (!options.skipCache) {
    const cached = getCached<T>(cacheKey);
    if (cached) {
      // Return immediately from cache - no async delay
      return cached.data;
    }
  }
  
  // Cache miss - fetch from network
  const url = new URL(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${endpoint}`);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value));
    }
  });
  
  // Fetch with only public API key (no auth header for shared caching)
  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      'apikey': import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
      'Content-Type': 'application/json',
    },
    // Let browser use its cache if server provides proper headers
    cache: 'default',
  });
  
  if (!response.ok) {
    throw new Error(`Catalog fetch failed: ${response.status}`);
  }
  
  const data = await response.json();
  
  // Determine TTL from response
  let ttlSeconds = parseTtlFromResponse(response, data);
  
  // For home endpoint, cap TTL to remaining time in current rotation bucket
  // This ensures cache expires when rotation changes
  if (isHomeEndpoint) {
    const now = new Date();
    const hoursInBucket = now.getUTCHours() % 12;
    const minutesRemaining = (12 - hoursInBucket) * 60 - now.getUTCMinutes();
    const secondsRemaining = minutesRemaining * 60;
    ttlSeconds = Math.min(ttlSeconds, Math.max(secondsRemaining, 300)); // Min 5 minutes
    console.log('[CACHE] catalog-home rotation TTL capped to', ttlSeconds, 's');
  }
  
  // Store in cache for next time
  setCache(cacheKey, data, ttlSeconds);
  
  return data;
}

// Clear expired cache on module load
clearExpiredCache();