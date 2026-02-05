/**
 * Feature Flags Helper
 * Centralized feature flag resolution with platform-specific overrides
 * Used by catalog-search, market-search-proxy, and other endpoints
 */

// Use 'any' type to avoid importing the Supabase SDK (prevents bundle bloat)
type SupabaseClient = any;

// ─── Types ───────────────────────────────────────────────────────────────────

export interface FeatureFlagRow {
  key: string;
  platform: string;
  enabled: boolean;
}

export type ClientPlatform = "ios" | "android" | "web" | undefined;

export interface EnabledProviders {
  amazon: boolean;
  ebay: boolean;
  sources: ("ebay" | "amazon")[];
}

// ─── Feature Flag Resolution ─────────────────────────────────────────────────

/**
 * Resolve which providers are enabled based on feature_flags table
 * Platform-specific overrides take precedence over 'all' platform settings
 * 
 * @param supabase - Supabase client
 * @param clientPlatform - Optional client platform (ios, android, web)
 * @param requestedProvider - Optional requested provider filter (mixed, amazon, ebay)
 * @returns EnabledProviders object with amazon/ebay booleans and sources array
 */
export async function getEnabledProviders(
  supabase: SupabaseClient,
  clientPlatform?: ClientPlatform,
  requestedProvider?: string | null
): Promise<EnabledProviders> {
  try {
    // Build list of platforms to check
    const platforms = ["all"];
    if (clientPlatform) {
      platforms.push(clientPlatform);
    }

    // Fetch all relevant flags
    const { data: flags, error } = await supabase
      .from("feature_flags")
      .select("key, platform, enabled")
      .in("key", ["enable_amazon", "enable_ebay"])
      .in("platform", platforms);

    if (error) {
      console.error("[FEATURE_FLAGS] error", error.message);
      // Default to both enabled on error
      return resolveFromRequestedProvider(true, true, requestedProvider);
    }

    // Resolve flags (platform-specific overrides 'all')
    const resolveFlag = (key: string): boolean => {
      const allFlag = (flags as FeatureFlagRow[] | null)?.find((f) => f.key === key && f.platform === "all");
      const platformFlag = clientPlatform 
        ? (flags as FeatureFlagRow[] | null)?.find((f) => f.key === key && f.platform === clientPlatform)
        : null;
      
      // Platform-specific takes precedence
      if (platformFlag) {
        return platformFlag.enabled;
      }
      // Fall back to 'all' flag
      if (allFlag) {
        return allFlag.enabled;
      }
      // Default to enabled if no flag exists
      return true;
    };

    const amazonEnabled = resolveFlag("enable_amazon");
    const ebayEnabled = resolveFlag("enable_ebay");

    console.log("[FEATURE_FLAGS] resolved", JSON.stringify({
      amazon: amazonEnabled,
      ebay: ebayEnabled,
      platform: clientPlatform || "all",
      requestedProvider,
    }));

    return resolveFromRequestedProvider(amazonEnabled, ebayEnabled, requestedProvider);
  } catch (err) {
    console.error("[FEATURE_FLAGS] exception", err);
    // Default to both enabled on exception
    return resolveFromRequestedProvider(true, true, requestedProvider);
  }
}

/**
 * Apply requested provider filter to enabled providers
 */
function resolveFromRequestedProvider(
  amazonEnabled: boolean,
  ebayEnabled: boolean,
  requestedProvider?: string | null
): EnabledProviders {
  const sources: ("ebay" | "amazon")[] = [];
  
  // Map provider param values
  const providerLower = requestedProvider?.toLowerCase() || "mixed";
  
  // Determine which sources to include based on request and flags
  const wantsAmazon = providerLower === "mixed" || providerLower === "amazon" || providerLower === "both" || providerLower === "all";
  const wantsEbay = providerLower === "mixed" || providerLower === "ebay" || providerLower === "both" || providerLower === "all";
  
  const effectiveAmazon = amazonEnabled && wantsAmazon;
  const effectiveEbay = ebayEnabled && wantsEbay;
  
  if (effectiveEbay) sources.push("ebay");
  if (effectiveAmazon) sources.push("amazon");

  return {
    amazon: effectiveAmazon,
    ebay: effectiveEbay,
    sources,
  };
}

/**
 * Extract client platform from request headers or query params
 */
export function getClientPlatform(req: Request): ClientPlatform {
  const url = new URL(req.url);
  
  // Check query param first (explicit)
  const paramPlatform = url.searchParams.get("clientPlatform") || url.searchParams.get("platform");
  if (paramPlatform) {
    const lower = paramPlatform.toLowerCase();
    if (lower === "ios" || lower === "android" || lower === "web") {
      return lower;
    }
  }
  
  // Check x-client-platform header
  const headerPlatform = req.headers.get("x-client-platform");
  if (headerPlatform) {
    const lower = headerPlatform.toLowerCase();
    if (lower === "ios" || lower === "android" || lower === "web") {
      return lower;
    }
  }
  
  // Detect from User-Agent
  const userAgent = req.headers.get("user-agent") || "";
  const uaLower = userAgent.toLowerCase();
  
  if (uaLower.includes("iphone") || uaLower.includes("ipad") || uaLower.includes("ios")) {
    return "ios";
  }
  if (uaLower.includes("android")) {
    return "android";
  }
  
  return undefined;
}
