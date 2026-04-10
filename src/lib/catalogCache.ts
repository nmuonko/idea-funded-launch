/**
 * Client-side catalog cache for web
 * Respects backend TTL and works across users for public catalog data
 * 
 * Features:
 * - In-memory LRU cache (50 entries) for <1ms repeat lookups
 * - localStorage persistence for cross-session caching
 * - Stale-while-revalidate: shows stale data instantly, refreshes in background
 * - Query normalization for maximum cache hits
 */
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

const CACHE_PREFIX = 'afrishop_cache:v17:';
const DEFAULT_TTL_SECONDS = 3600; // 1 hour fallback
const LRU_MAX_SIZE = 100;
const SWR_STALE_MULTIPLIER = 2; // Serve stale up to 2x TTL

interface CacheEntry<T> {
  value: T;
  cachedAt: number;
  ttlSeconds: number;
  expiresAt: number;
}

// ─── IN-MEMORY LRU CACHE ─────────────────────────────────────────────────────

class LRUCache<T> {
  private map = new Map<string, { value: T; cachedAt: number; expiresAt: number }>();
  private maxSize: number;

  constructor(maxSize: number) {
    this.maxSize = maxSize;
  }

  get(key: string): { value: T; cachedAt: number; expiresAt: number } | null {
    const entry = this.map.get(key);
    if (!entry) return null;
    // Move to end (most recently used)
    this.map.delete(key);
    this.map.set(key, entry);
    return entry;
  }

  set(key: string, value: T, cachedAt: number, expiresAt: number): void {
    if (this.map.has(key)) {
      this.map.delete(key);
    } else if (this.map.size >= this.maxSize) {
      // Evict oldest (first entry)
      const firstKey = this.map.keys().next().value;
      if (firstKey) this.map.delete(firstKey);
    }
    this.map.set(key, { value, cachedAt, expiresAt });
  }

  clear(): void {
    this.map.clear();
  }
}

const memoryCache = new LRUCache<any>(LRU_MAX_SIZE);

// ─── QUERY NORMALIZATION ──────────────────────────────────────────────────────

/**
 * Remove accents/diacritics from text for consistent cache keys
 * e.g., "téléphone" → "telephone", "café" → "cafe"
 */
function removeAccents(str: string): string {
  return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/**
 * Normalize a search query for cache key consistency
 * - trim, lowercase, collapse whitespace
 * - remove accents/diacritics
 * - remove unnecessary punctuation
 * - keep numbers
 * - max 120 chars
 */
export function normalizeQuery(q: string): string {
  if (!q) return '';
  let normalized = q.trim().toLowerCase();
  normalized = removeAccents(normalized);
  normalized = normalized.replace(/\s+/g, ' ');
  // Remove punctuation except hyphens between words and dots in decimals
  normalized = normalized.replace(/[^\w\s\-\.]/g, '');
  // Collapse multiple hyphens/dots
  normalized = normalized.replace(/\-{2,}/g, '-').replace(/\.{2,}/g, '.');
  // Max 120 chars
  if (normalized.length > 120) normalized = normalized.substring(0, 120).trim();
  return normalized;
}

/**
 * Stable JSON stringification with sorted keys for deterministic cache keys
 */
export function stableStringify(obj: Record<string, any>): string {
  if (!obj || Object.keys(obj).length === 0) return '';
  const sorted = Object.keys(obj).sort().reduce<Record<string, any>>((acc, key) => {
    const val = obj[key];
    if (val !== undefined && val !== null && val !== '') {
      acc[key] = val;
    }
    return acc;
  }, {});
  return Object.keys(sorted).length > 0 ? JSON.stringify(sorted) : '';
}

// ─── CACHE KEY GENERATION ─────────────────────────────────────────────────────

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
    
    // Normalize string values
    if (typeof value === 'string') {
      value = normalizeQuery(value);
    }
    
    normalized[key] = String(value);
  });
  
  const paramString = Object.entries(normalized)
    .map(([k, v]) => `${k}=${v}`)
    .join('&');
    
  return `${CACHE_PREFIX}${endpoint}:${paramString}`;
}

// ─── CACHE READ/WRITE ─────────────────────────────────────────────────────────

/**
 * Get cached data — checks memory LRU first, then localStorage
 * Returns fresh or stale data with metadata
 */
export function getCached<T>(key: string): { data: T; expiresIn: number; isStale: boolean } | null {
  const now = Date.now();

  // 1. Check in-memory LRU first (<1ms)
  const memEntry = memoryCache.get(key);
  if (memEntry) {
    const expiresIn = Math.round((memEntry.expiresAt - now) / 1000);
    if (expiresIn > 0) {
      return { data: memEntry.value, expiresIn, isStale: false };
    }
    // Check SWR window (serve stale up to 2x TTL)
    const ttl = memEntry.expiresAt - memEntry.cachedAt;
    const swrDeadline = memEntry.expiresAt + ttl; // 2x original TTL
    if (now < swrDeadline) {
      return { data: memEntry.value, expiresIn: 0, isStale: true };
    }
  }

  // 2. Check localStorage (<5ms)
  try {
    const stored = localStorage.getItem(key);
    if (!stored) return null;
    
    const entry = JSON.parse(stored) as CacheEntry<T>;
    const expiresIn = Math.round((entry.expiresAt - now) / 1000);
    
    if (expiresIn > 0) {
      // Fresh — also populate memory LRU
      memoryCache.set(key, entry.value, entry.cachedAt, entry.expiresAt);
      return { data: entry.value, expiresIn, isStale: false };
    }
    
    // Check SWR window
    const swrDeadline = entry.expiresAt + (entry.ttlSeconds * 1000 * (SWR_STALE_MULTIPLIER - 1));
    if (now < swrDeadline) {
      memoryCache.set(key, entry.value, entry.cachedAt, entry.expiresAt);
      return { data: entry.value, expiresIn: 0, isStale: true };
    }
    
    // Fully expired
    localStorage.removeItem(key);
    return null;
  } catch (e) {
    return null;
  }
}

/**
 * Store data in both memory LRU and localStorage
 */
export function setCache<T>(key: string, data: T, ttlSeconds: number): void {
  const now = Date.now();
  const expiresAt = now + ttlSeconds * 1000;

  // Memory LRU
  memoryCache.set(key, data, now, expiresAt);

  // localStorage
  try {
    const entry: CacheEntry<T> = { value: data, cachedAt: now, ttlSeconds, expiresAt };
    localStorage.setItem(key, JSON.stringify(entry));
  } catch (e) {
    clearExpiredCache();
    try {
      const entry: CacheEntry<T> = { value: data, cachedAt: Date.now(), ttlSeconds, expiresAt };
      localStorage.setItem(key, JSON.stringify(entry));
    } catch (_) {
      // Storage truly full, LRU still works
    }
  }
}

// ─── RESPONSE PARSING ─────────────────────────────────────────────────────────

/**
 * Parse TTL from Cache-Control header or response body
 */
export function parseTtlFromResponse(response: Response, data: any): number {
  const cacheControl = response.headers.get('Cache-Control');
  if (cacheControl) {
    const maxAgeMatch = cacheControl.match(/max-age=(\d+)/);
    if (maxAgeMatch) return parseInt(maxAgeMatch[1], 10);
  }
  if (data?.ttlSeconds) return data.ttlSeconds;
  if (data?.ttl) return data.ttl;
  return DEFAULT_TTL_SECONDS;
}

/**
 * Parse cache status headers from backend response
 */
function parseCacheHeaders(response: Response): { 
  cacheStatus: 'HIT' | 'STALE' | 'MISS'; 
  cacheAge: number; 
  responseTime: number;
} {
  return {
    cacheStatus: (response.headers.get('X-Cache-Status') as any) || 'MISS',
    cacheAge: parseInt(response.headers.get('X-Cache-Age') || '0', 10),
    responseTime: parseInt(response.headers.get('X-Response-Time') || '0', 10),
  };
}

// ─── CACHE MAINTENANCE ───────────────────────────────────────────────────────

/**
 * Clear all expired cache entries from localStorage
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
          // Remove if past SWR window
          const swrDeadline = entry.expiresAt + (entry.ttlSeconds * 1000 * (SWR_STALE_MULTIPLIER - 1));
          if (now >= swrDeadline) {
            keysToRemove.push(key);
          }
        }
      } catch (e) {
        keysToRemove.push(key!);
      }
    }
  }
  
  keysToRemove.forEach(key => localStorage.removeItem(key));
}

// ─── (rotation key removed — client now respects server ttlSeconds directly) ──

// ─── MAIN FETCH FUNCTIONS ─────────────────────────────────────────────────────

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
  
  // Check cache first (fresh only)
  if (!options.skipCache) {
    const cached = getCached<T>(cacheKey);
    if (cached && !cached.isStale) {
      return cached.data;
    }
  }
  
  // Fetch from network
  const url = new URL(`${SUPABASE_URL}/functions/v1/${endpoint}`);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value));
    }
  });

  // When skipCache is set, add a cache-bust param to defeat CDN/proxy caches
  if (options.skipCache) {
    url.searchParams.set('_cb', String(Date.now()));
  }
  
  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      'apikey': SUPABASE_ANON_KEY,
      'Content-Type': 'application/json',
    },
    // Bypass browser HTTP cache entirely when skipCache is set
    cache: options.skipCache ? 'no-store' : 'default',
  });
  
  if (!response.ok) {
    throw new Error(`Catalog fetch failed: ${response.status}`);
  }
  
  const data = await response.json();
  
  // Use server ttlSeconds directly — no client-side TTL cap
  const ttlSeconds = parseTtlFromResponse(response, data);
  
  setCache(cacheKey, data, ttlSeconds);
  
  return data;
}

/**
 * Stale-while-revalidate fetch for catalog search
 * 
 * 1. If cache hit (fresh): return immediately
 * 2. If cache hit (stale): return immediately + fire background refresh
 * 3. If cache miss: fetch from network
 * 
 * @param onUpdate - called when fresh data arrives after a stale response
 * @returns { data, isStale } immediately from cache, or fresh from network
 */
export async function cachedCatalogFetchWithSwr<T>(
  endpoint: string,
  params: Record<string, any> = {},
  options: {
    skipCache?: boolean;
    onUpdate?: (freshData: T) => void;
    signal?: AbortSignal;
  } = {}
): Promise<{ data: T; isStale: boolean; fromCache: boolean }> {
  const cacheKey = generateCacheKey(endpoint, params);
  
  // 1. Check cache
  if (!options.skipCache) {
    const cached = getCached<T>(cacheKey);
    
    if (cached && !cached.isStale) {
      // Fresh cache hit — instant return
      return { data: cached.data, isStale: false, fromCache: true };
    }
    
    if (cached && cached.isStale) {
      // Stale cache hit — return stale immediately, refresh in background
      const staleData = cached.data;
      
      // Fire background refresh (non-blocking)
      fetchFromNetwork<T>(endpoint, params, options.signal, options.skipCache)
        .then(freshData => {
          const ttl = parseTtlFromNetworkResponse(freshData);
          setCache(cacheKey, freshData, ttl);
          options.onUpdate?.(freshData);
        })
        .catch(() => {
          // Background refresh failed — stale data is still being shown
        });
      
      return { data: staleData, isStale: true, fromCache: true };
    }
  }
  
  // 2. Cache miss — fetch from network
  const data = await fetchFromNetwork<T>(endpoint, params, options.signal, options.skipCache);
  const ttl = parseTtlFromNetworkResponse(data);
  setCache(cacheKey, data, ttl);
  
  return { data, isStale: false, fromCache: false };
}

/**
 * Raw network fetch helper for catalog endpoints
 */
async function fetchFromNetwork<T>(
  endpoint: string,
  params: Record<string, any>,
  signal?: AbortSignal,
  skipBrowserCache?: boolean
): Promise<T> {
  const url = new URL(`${SUPABASE_URL}/functions/v1/${endpoint}`);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value));
    }
  });

  if (skipBrowserCache) {
    url.searchParams.set('_cb', String(Date.now()));
  }
  
  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      'apikey': SUPABASE_ANON_KEY,
      'Content-Type': 'application/json',
    },
    cache: skipBrowserCache ? 'no-store' : 'default',
    signal,
  });
  
  if (!response.ok) {
    throw new Error(`Catalog fetch failed: ${response.status}`);
  }
  
  return response.json();
}

/**
 * Extract TTL from network response data
 */
function parseTtlFromNetworkResponse(data: any): number {
  if (data?.ttlSeconds) return data.ttlSeconds;
  if (data?.ttl) return data.ttl;
  return DEFAULT_TTL_SECONDS;
}

/**
 * Clear all catalog-home cache entries (used after admin Rebuild/Publish)
 */
export function clearCatalogHomeCache(): number {
  const keysToRemove: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith(`${CACHE_PREFIX}catalog-home:`)) {
      keysToRemove.push(key);
    }
  }
  keysToRemove.forEach(key => localStorage.removeItem(key));
  memoryCache.clear();
  return keysToRemove.length;
}

/**
 * Clear ALL catalog cache entries from localStorage AND in-memory LRU.
 * Used for automatic recovery when startup network errors are detected.
 */
export function clearAllCatalogCache(): number {
  const prefixes = ['afrishop_cache:', 'afrishop_curated:', 'afrishop_curated_v2:'];
  const keysToRemove: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key) continue;
    if (prefixes.some(p => key.startsWith(p))) {
      keysToRemove.push(key);
    }
  }
  keysToRemove.forEach(key => localStorage.removeItem(key));
  memoryCache.clear();
  console.log(`[CatalogCache] Cleared ${keysToRemove.length} cache entries`);
  return keysToRemove.length;
}

// ─── PREFETCH HELPER ──────────────────────────────────────────────────────────

const prefetchedKeys = new Set<string>();

/**
 * Silently prefetch a category's first page into the cache.
 * Fire-and-forget — no UI impact, no error surfacing.
 * Uses the exact same cache key as CategoryResultsPage so it gets an instant hit.
 */
export function prefetchCatalogCategory(category: string, language: string): void {
  const key = `${category}:${language}`;
  if (prefetchedKeys.has(key)) return;
  prefetchedKeys.add(key);
  cachedCatalogFetch('catalog-category', {
    category,
    pageSize: 100,
    client: 'web',
    language,
  }).catch(() => {});
}

// ─── SEARCH PREFETCH HELPER ───────────────────────────────────────────────────

const prefetchedSearchKeys = new Set<string>();

/**
 * Silently prefetch search results into the cache.
 * Fire-and-forget — no UI impact, no error surfacing.
 * Uses the exact same cache key as SearchResults will use via cachedCatalogFetchWithSwr.
 */
export function prefetchCatalogSearch(query: string, language: string): void {
  const normalized = normalizeQuery(query);
  if (!normalized || normalized.length < 2) return;
  const key = `search:${normalized}:${language}`;
  if (prefetchedSearchKeys.has(key)) return;
  prefetchedSearchKeys.add(key);
  cachedCatalogFetch('catalog-search', {
    q: query.trim(),
    limit: String(PAGE_SIZE_SEARCH),
    page: '0',
    client: 'web',
    language,
  }).catch(() => {});
}

const PAGE_SIZE_SEARCH = 500;

// Clear expired cache on module load
clearExpiredCache();
