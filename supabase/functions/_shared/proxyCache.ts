/**
 * Market Search Proxy - Cache Helper
 * SHA-256 based cache key generation and cache operations
 */

import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

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

const DEFAULT_TTL_SECONDS = 900; // 15 minutes

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
  ttlSeconds: number = DEFAULT_TTL_SECONDS
): Promise<void> {
  try {
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
    
    const { error } = await supabase
      .from("search_proxy_cache")
      .upsert({
        cache_key: cacheKey,
        source,
        payload,
        expires_at: expiresAt.toISOString(),
        created_at: new Date().toISOString(),
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
