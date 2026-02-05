/**
 * Client-side catalog cache for web
 * Respects backend TTL and works across users for public catalog data
 */

const CACHE_PREFIX = 'afrishop_cache:';
const DEFAULT_TTL_SECONDS = 3600; // 1 hour fallback

interface CacheEntry<T> {
  value: T;
  cachedAt: number;
  ttlSeconds: number;
  expiresAt: number;
}

/**
 * Generate a stable cache key from parameters
 */
export function generateCacheKey(endpoint: string, params: Record<string, any>): string {
  // Normalize and sort params for consistent keys
  const normalized: Record<string, string> = {};
  
  Object.keys(params).sort().forEach(key => {
    let value = params[key];
    if (value === undefined || value === null || value === '') return;
    
    // Normalize string values
    if (typeof value === 'string') {
      value = value.trim().toLowerCase().replace(/\s+/g, ' ');
    }
    
    normalized[key] = String(value);
  });
  
  const paramString = Object.entries(normalized)
    .map(([k, v]) => `${k}=${v}`)
    .join('&');
    
  return `${CACHE_PREFIX}${endpoint}:${paramString}`;
}

/**
 * Get cached data if not expired
 */
export function getCached<T>(key: string): { data: T; expiresIn: number } | null {
  try {
    const stored = localStorage.getItem(key);
    if (!stored) return null;
    
    const entry = JSON.parse(stored) as CacheEntry<T>;
    const now = Date.now();
    
    if (now >= entry.expiresAt) {
      console.log('[CACHE] EXPIRED key=', key);
      localStorage.removeItem(key);
      return null;
    }
    
    const expiresIn = Math.round((entry.expiresAt - now) / 1000);
    console.log('[CACHE] HIT key=', key, 'expiresIn=', expiresIn, 's');
    return { data: entry.value, expiresIn };
  } catch (e) {
    console.error('[CACHE] Error reading cache:', e);
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
 * Cached fetch for catalog endpoints
 * Uses public API key only (no auth) for shared caching
 */
export async function cachedCatalogFetch<T>(
  endpoint: string,
  params: Record<string, any> = {},
  options: { skipCache?: boolean } = {}
): Promise<T> {
  const cacheKey = generateCacheKey(endpoint, params);
  
  // Check cache first (unless skipping)
  if (!options.skipCache) {
    const cached = getCached<T>(cacheKey);
    if (cached) {
      return cached.data;
    }
  }
  
  console.log('[CACHE] MISS key=', cacheKey, 'fetching');
  
  // Build URL with params
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
  const ttlSeconds = parseTtlFromResponse(response, data);
  
  // Store in cache
  setCache(cacheKey, data, ttlSeconds);
  
  return data;
}

// Clear expired cache on module load
clearExpiredCache();