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
 * Heuristic mobile detection for frozen app builds.
 * If a stale mobile header keeps sending staging, we force production fallback.
 */
function isLikelyMobileRequest(req: Request): boolean {
  const h = req.headers;
  const deviceId = h.get("x-device-id") || "";
  if (deviceId.trim().length > 0) return true;

  const platform = (h.get("x-supabase-client-platform") || "").toLowerCase();
  if (platform.includes("ios") || platform.includes("android")) return true;

  const afrishopClient = (h.get("x-afrishop-client") || "").toLowerCase();
  if (afrishopClient.includes("mobile")) return true;

  const ua = (h.get("user-agent") || "").toLowerCase();
  return ua.includes("okhttp") || ua.includes("expo") || ua.includes("reactnative") || ua.includes("react-native") || ua.includes("capacitor");
}

/**
 * Detect environment from request
 * Priority: Query param > Header > Default production
 */
export function getEnvironmentFromRequest(req: Request): EnvironmentName {
  try {
    // CRITICAL: Check mobile FIRST — frozen mobile builds send ?env=staging
    // as a query param that we MUST override to production
    const mobile = isLikelyMobileRequest(req);

    const url = new URL(req.url);
    const envParam = url.searchParams.get("env")?.toLowerCase().trim();

    if (envParam === "staging" && mobile) {
      console.warn("[environmentResolver] Mobile request sent ?env=staging query param; forcing production");
      return "production";
    }
    if (envParam === "production") return "production";
    if (envParam === "staging") return "staging";

    const header = req.headers.get("x-afrishop-environment")?.toLowerCase().trim();
    if (header === "production") return "production";

    if (header === "staging") {
      if (mobile) {
        console.warn("[environmentResolver] Mobile request sent staging header; forcing production fallback");
        return "production";
      }
      return "staging";
    }

    if (header) {
      console.warn("[environmentResolver] Invalid header value:", header);
    }

    return "production";
  } catch (err) {
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
