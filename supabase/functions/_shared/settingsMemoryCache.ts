/**
 * In-Memory Settings Cache for Edge Functions
 * 
 * Provides TTL-based caching for frequently accessed settings
 * to eliminate redundant database queries per request.
 * 
 * Cache is request-scoped in edge functions (each invocation is fresh),
 * but within a single request, multiple calls return cached values.
 */

import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

// Cache TTL in milliseconds (60 seconds)
const CACHE_TTL_MS = 60_000;

// Token cache TTL (1.5 hours - tokens valid for 2 hours)
const TOKEN_CACHE_TTL_MS = 90 * 60 * 1000;

// ─── TYPES ────────────────────────────────────────────────────────────────────

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

// ─── SETTINGS CACHE ───────────────────────────────────────────────────────────

let adminSettingsCache: CacheEntry<Map<string, string>> | null = null;
let globalSettingsCache: CacheEntry<Record<string, unknown>> | null = null;

/**
 * Get all admin_settings with in-memory caching
 * Returns a Map of key -> value for quick lookups
 */
export async function getCachedAdminSettings(
  supabase: SupabaseClient
): Promise<Map<string, string>> {
  const now = Date.now();
  
  // Return cached if valid
  if (adminSettingsCache && adminSettingsCache.expiresAt > now) {
    return adminSettingsCache.value;
  }
  
  // Fetch all settings in one query
  const { data, error } = await supabase
    .from("admin_settings")
    .select("key, value");
  
  if (error) {
    console.error("[SETTINGS_CACHE] Error fetching admin_settings:", error.message);
    // Return empty map on error, don't cache
    return new Map();
  }
  
  // Build settings map
  const settingsMap = new Map<string, string>();
  for (const row of data || []) {
    settingsMap.set(row.key, row.value);
  }
  
  // Cache it
  adminSettingsCache = {
    value: settingsMap,
    expiresAt: now + CACHE_TTL_MS,
  };
  
  console.log(`[SETTINGS_CACHE] Loaded ${settingsMap.size} admin_settings`);
  
  return settingsMap;
}

/**
 * Get a specific admin setting value
 */
export async function getCachedAdminSetting(
  supabase: SupabaseClient,
  key: string
): Promise<string | null> {
  const settings = await getCachedAdminSettings(supabase);
  return settings.get(key) || null;
}

/**
 * Get global settings from 'settings' table with caching
 */
export async function getCachedGlobalSettings(
  supabase: SupabaseClient
): Promise<Record<string, unknown>> {
  const now = Date.now();
  
  if (globalSettingsCache && globalSettingsCache.expiresAt > now) {
    return globalSettingsCache.value;
  }
  
  const { data, error } = await supabase
    .from("settings")
    .select("*")
    .limit(1)
    .single();
  
  if (error) {
    console.error("[SETTINGS_CACHE] Error fetching settings:", error.message);
    return {};
  }
  
  globalSettingsCache = {
    value: data || {},
    expiresAt: now + CACHE_TTL_MS,
  };
  
  return globalSettingsCache.value;
}

// ─── EBAY TOKEN CACHE ─────────────────────────────────────────────────────────

interface EbayTokenCache {
  token: string;
  expiresAt: number;
}

let ebayTokenCache: EbayTokenCache | null = null;

/**
 * Get eBay OAuth token with in-memory caching
 * Caches token for 1.5 hours (tokens valid for 2 hours)
 */
export async function getCachedEbayToken(): Promise<string | null> {
  const now = Date.now();
  
  // Return cached token if still valid (with 10 minute buffer)
  if (ebayTokenCache && ebayTokenCache.expiresAt > now + 10 * 60 * 1000) {
    return ebayTokenCache.token;
  }
  
  const clientId = Deno.env.get("EBAY_CLIENT_ID");
  const clientSecret = Deno.env.get("EBAY_CLIENT_SECRET");

  if (!clientId || !clientSecret) {
    console.error("[EBAY_TOKEN_CACHE] Missing EBAY_CLIENT_ID or EBAY_CLIENT_SECRET");
    return null;
  }

  try {
    const credentials = btoa(`${clientId}:${clientSecret}`);
    const response = await fetch("https://api.ebay.com/identity/v1/oauth2/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Authorization": `Basic ${credentials}`,
      },
      body: "grant_type=client_credentials&scope=https://api.ebay.com/oauth/api_scope",
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("[EBAY_TOKEN_CACHE] Token error:", response.status, errorText);
      return null;
    }

    const data = await response.json();
    const token = data.access_token;
    const expiresIn = data.expires_in || 7200; // Default 2 hours
    
    // Cache the token
    ebayTokenCache = {
      token,
      expiresAt: now + Math.min(expiresIn * 1000, TOKEN_CACHE_TTL_MS),
    };
    
    console.log(`[EBAY_TOKEN_CACHE] Token refreshed, expires in ${expiresIn}s`);
    
    return token;
  } catch (error) {
    console.error("[EBAY_TOKEN_CACHE] Token fetch error:", error);
    return null;
  }
}

/**
 * Invalidate the eBay token cache (call on 401 errors)
 */
export function invalidateEbayTokenCache(): void {
  ebayTokenCache = null;
  console.log("[EBAY_TOKEN_CACHE] Cache invalidated");
}

// ─── CACHE INVALIDATION ───────────────────────────────────────────────────────

/**
 * Invalidate all in-memory caches
 * Call this after admin updates settings
 */
export function invalidateAllCaches(): void {
  adminSettingsCache = null;
  globalSettingsCache = null;
  console.log("[SETTINGS_CACHE] All caches invalidated");
}

/**
 * Invalidate only settings caches (not tokens)
 */
export function invalidateSettingsCaches(): void {
  adminSettingsCache = null;
  globalSettingsCache = null;
  console.log("[SETTINGS_CACHE] Settings caches invalidated");
}
