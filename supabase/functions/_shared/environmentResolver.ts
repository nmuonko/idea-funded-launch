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
 * Priority: Header > Query param > Default (production)
 */
export function getEnvironmentFromRequest(req: Request): EnvironmentName {
  // 1. Check header
  const header = req.headers.get("X-Afrishop-Environment");
  if (header === "staging") return "staging";
  if (header === "production") return "production";

  // 2. Check query param
  const url = new URL(req.url);
  const envParam = url.searchParams.get("env");
  if (envParam === "staging") return "staging";
  if (envParam === "production") return "production";

  // 3. Default to production
  return "production";
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
