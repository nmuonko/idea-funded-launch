/**
 * Environment Resolver
 * Detects environment from request headers or query params
 * Used by all catalog endpoints for environment-aware responses
 */

export type EnvironmentName = "production" | "staging";

export interface EnvironmentConfig {
  id: string;
  name: EnvironmentName;
  is_default: boolean;
  catalog_enabled: boolean;
  catalog_mode: "webview" | "native" | "hybrid";
  api_base_url: string;
  provider_secrets_prefix: string;
  min_app_version: string;
  ota_enabled: boolean;
  ota_channel: string;
}

// In-memory cache for environments (short TTL for quick updates)
let envCache: Map<string, { data: EnvironmentConfig; expires: number }> = new Map();
const CACHE_TTL_MS = 30_000; // 30 seconds

/**
 * Detect environment from request
 * Priority: Header (if valid) > Query param (if valid) > Default (production)
 * Safe fallback chain - always returns valid environment
 */
export function getEnvironmentFromRequest(req: Request): EnvironmentName {
  try {
    // 1. Check header first (if it exists and is valid)
    const header = req.headers.get("X-Afrishop-Environment");
    if (header) {
      const normalizedHeader = header.toLowerCase().trim();
      if (normalizedHeader === "staging") return "staging";
      if (normalizedHeader === "production") return "production";
      // Header exists but invalid - fall through to query param
      console.warn("[environmentResolver] Invalid header value:", header);
    }

    // 2. Check query param (if it exists and is valid)
    const url = new URL(req.url);
    const envParam = url.searchParams.get("env");
    if (envParam) {
      const normalizedParam = envParam.toLowerCase().trim();
      if (normalizedParam === "staging") return "staging";
      if (normalizedParam === "production") return "production";
      // Query param exists but invalid - fall through to default
      console.warn("[environmentResolver] Invalid query param value:", envParam);
    }

    // 3. Default to production (safe fallback)
    return "production";
  } catch (err) {
    // Any parsing error - default to production
    console.error("[environmentResolver] Error parsing request:", err);
    return "production";
  }
}

/**
 * Fetch environment config from database
 * Uses in-memory cache with short TTL
 */
export async function getEnvironmentConfig(
  supabase: any,
  envName: EnvironmentName
): Promise<EnvironmentConfig | null> {
  const cacheKey = `env:${envName}`;
  const cached = envCache.get(cacheKey);
  
  if (cached && Date.now() < cached.expires) {
    return cached.data;
  }

  const { data, error } = await supabase
    .from("environments")
    .select("*")
    .eq("name", envName)
    .maybeSingle();

  if (error) {
    console.error("[environmentResolver] Error fetching environment:", error);
    return null;
  }

  if (data) {
    envCache.set(cacheKey, { 
      data: data as EnvironmentConfig, 
      expires: Date.now() + CACHE_TTL_MS 
    });
  }

  return data as EnvironmentConfig | null;
}

/**
 * Get secret with environment prefix
 * In staging: STAGING_AMAZON_API_KEY
 * In production: AMAZON_API_KEY
 */
export function getEnvSecret(
  secretName: string,
  envConfig: EnvironmentConfig | null
): string | undefined {
  const prefix = envConfig?.provider_secrets_prefix || "";
  const fullName = prefix ? `${prefix}${secretName}` : secretName;
  return Deno.env.get(fullName);
}

/**
 * Check if catalog is enabled for the current environment
 */
export function isCatalogEnabled(envConfig: EnvironmentConfig | null): boolean {
  return envConfig?.catalog_enabled ?? false;
}

/**
 * Get catalog mode for the environment
 */
export function getCatalogMode(envConfig: EnvironmentConfig | null): "webview" | "native" | "hybrid" {
  return envConfig?.catalog_mode ?? "webview";
}

/**
 * Clear environment cache (useful for testing or admin updates)
 */
export function clearEnvironmentCache(): void {
  envCache.clear();
}
