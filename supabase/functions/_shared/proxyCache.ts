/**
 * Market Search Proxy - Cache Helper
 * SHA-256 based cache key generation, cache operations, and stale-while-revalidate logic
 */

// Use 'any' type to avoid importing the Supabase SDK (prevents bundle bloat)
type SupabaseClient = any;

export interface SearchParams {
  q: string;
  minPrice?: number;
  maxPrice?: number;
  condition: string;
  sort: string;
  limit: number;
  page: number;
  currency: string;
  country: string;
  category?: string;
  clientPlatform?: string;
}

export interface CachedPayload {
  items: unknown[];
  total: number;
  hasMore: boolean;
  fetchedAt: string;
}

export interface CacheResult {
  payload: CachedPayload;
  createdAt: Date;
  expiresAt: Date;
  ageSeconds: number;
  isExpired: boolean;
  isStale: boolean;
}

export interface ProxyCacheSettings {
  searchTtlSeconds: number;
  itemTtlSeconds: number;
  staleMaxSeconds: number;
}

// Default values if settings are missing
const DEFAULT_SEARCH_TTL = 900;      // 15 minutes
const DEFAULT_ITEM_TTL = 300;        // 5 minutes
const DEFAULT_STALE_MAX = 21600;     // 6 hours

/**
 * Fetch proxy cache settings from admin_settings table
 * Falls back to defaults if settings are missing
 */
export async function getProxyCacheSettings(
  supabase: SupabaseClient
): Promise<ProxyCacheSettings> {
  try {
    const { data, error } = await supabase
      .from("admin_settings")
      .select("key, value")
      .in("key", [
        "proxy_search_cache_ttl_seconds",
        "proxy_item_cache_ttl_seconds",
        "proxy_stale_max_seconds",
      ]);

    if (error) {
      console.log("[PROXY_CACHE] settings_error", JSON.stringify({ error: error.message }));
      return {
        searchTtlSeconds: DEFAULT_SEARCH_TTL,
        itemTtlSeconds: DEFAULT_ITEM_TTL,
        staleMaxSeconds: DEFAULT_STALE_MAX,
      };
    }

    const settings: Record<string, number> = {};
    for (const row of data || []) {
      const parsed = parseInt(row.value, 10);
      if (!isNaN(parsed) && parsed > 0) {
        settings[row.key] = parsed;
      }
    }

    return {
      searchTtlSeconds: settings["proxy_search_cache_ttl_seconds"] || DEFAULT_SEARCH_TTL,
      itemTtlSeconds: settings["proxy_item_cache_ttl_seconds"] || DEFAULT_ITEM_TTL,
      staleMaxSeconds: settings["proxy_stale_max_seconds"] || DEFAULT_STALE_MAX,
    };
  } catch (err) {
    console.error("[PROXY_CACHE] settings_exception", err);
    return {
      searchTtlSeconds: DEFAULT_SEARCH_TTL,
      itemTtlSeconds: DEFAULT_ITEM_TTL,
      staleMaxSeconds: DEFAULT_STALE_MAX,
    };
  }
}

/**
 * Generate a SHA-256 hash of the search parameters
 * Returns a hex string prefixed with source
 */
export async function generateCacheKey(
  source: "ebay" | "amazon",
  params: SearchParams
): Promise<string> {
  // Build deterministic string from params
  const keyParts = [
    source,
    params.q.toLowerCase().trim(),
    params.minPrice?.toString() || "",
    params.maxPrice?.toString() || "",
    params.condition,
    params.sort,
    params.limit.toString(),
    params.page.toString(),
    params.currency.toUpperCase(),
    params.country.toUpperCase(),
    params.category || "",
    params.clientPlatform || "",
  ];
  
  const keyString = keyParts.join("|");
  
  // Generate SHA-256 hash
  const encoder = new TextEncoder();
  const data = encoder.encode(keyString);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
  
  // Return prefixed key for easy identification
  return `${source}:${hashHex.slice(0, 32)}`;
}

/**
 * Get cached result with age information for stale-while-revalidate
 * Returns null if not found, or CacheResult with freshness info
 */
export async function getCacheWithAge(
  supabase: SupabaseClient,
  cacheKey: string,
  ttlFreshSeconds: number,
  staleMaxSeconds: number
): Promise<CacheResult | null> {
  try {
    const { data, error } = await supabase
      .from("search_proxy_cache")
      .select("payload, expires_at, created_at")
      .eq("cache_key", cacheKey)
      .maybeSingle();
    
    if (error) {
      console.log("[PROXY_CACHE] cache_error", JSON.stringify({ 
        cacheKey: cacheKey.slice(0, 20), 
        error: error.message 
      }));
      return null;
    }
    
    if (!data) {
      return null;
    }
    
    const now = new Date();
    const createdAt = new Date(data.created_at);
    const expiresAt = new Date(data.expires_at);
    const ageSeconds = Math.floor((now.getTime() - createdAt.getTime()) / 1000);
    const isExpired = expiresAt <= now;
    
    // Check if cache is too old (beyond stale max)
    if (ageSeconds > staleMaxSeconds) {
      console.log("[PROXY_CACHE] cache_too_old", JSON.stringify({ 
        cacheKey: cacheKey.slice(0, 20),
        ageSeconds,
        staleMaxSeconds,
      }));
      return null;
    }
    
    return {
      payload: data.payload as CachedPayload,
      createdAt,
      expiresAt,
      ageSeconds,
      isExpired,
      isStale: isExpired, // Stale if past expires_at but within staleMax
    };
  } catch (err) {
    console.error("[PROXY_CACHE] cache_lookup_error", err);
    return null;
  }
}

/**
 * Legacy function for backward compatibility
 * Get cached result from search_proxy_cache
 * Returns null if not found or expired
 */
export async function getCachedResult(
  supabase: SupabaseClient,
  cacheKey: string
): Promise<CachedPayload | null> {
  try {
    const { data, error } = await supabase
      .from("search_proxy_cache")
      .select("payload, expires_at")
      .eq("cache_key", cacheKey)
      .maybeSingle();
    
    if (error) {
      console.log("[SEARCH_PROXY] cache_error", JSON.stringify({ 
        cacheKey: cacheKey.slice(0, 20), 
        error: error.message 
      }));
      return null;
    }
    
    if (!data) {
      return null;
    }
    
    // Check expiration
    const expiresAt = new Date(data.expires_at);
    if (expiresAt <= new Date()) {
      console.log("[SEARCH_PROXY] cache_expired", JSON.stringify({ 
        cacheKey: cacheKey.slice(0, 20) 
      }));
      return null;
    }
    
    return data.payload as CachedPayload;
  } catch (err) {
    console.error("[SEARCH_PROXY] cache_lookup_error", err);
    return null;
  }
}

/**
 * Store result in search_proxy_cache with TTL
 */
export async function setCachedResult(
  supabase: SupabaseClient,
  cacheKey: string,
  source: "ebay" | "amazon",
  payload: CachedPayload,
  ttlSeconds: number
): Promise<void> {
  try {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + ttlSeconds * 1000);
    
    const { error } = await supabase
      .from("search_proxy_cache")
      .upsert({
        cache_key: cacheKey,
        source,
        payload,
        expires_at: expiresAt.toISOString(),
        created_at: now.toISOString(),
      }, { onConflict: "cache_key" });
    
    if (error) {
      console.error("[SEARCH_PROXY] cache_write_error", JSON.stringify({
        cacheKey: cacheKey.slice(0, 20),
        error: error.message,
      }));
    }
  } catch (err) {
    console.error("[SEARCH_PROXY] cache_set_error", err);
  }
}

/**
 * Check if a cache entry is expired
 */
export function isExpired(expiresAt: string): boolean {
  return new Date(expiresAt) <= new Date();
}

/**
 * Cleanup expired cache entries (called periodically)
 */
export async function cleanupExpiredCache(
  supabase: SupabaseClient
): Promise<number> {
  try {
    const { data, error } = await supabase
      .from("search_proxy_cache")
      .delete()
      .lt("expires_at", new Date().toISOString())
      .select("cache_key");
    
    if (error) {
      console.error("[SEARCH_PROXY] cleanup_error", error.message);
      return 0;
    }
    
    return data?.length || 0;
  } catch (err) {
    console.error("[SEARCH_PROXY] cleanup_exception", err);
    return 0;
  }
}
