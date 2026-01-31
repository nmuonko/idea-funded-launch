/**
 * Catalog Settings Helper
 * Centralized access to admin_settings for catalog provider configuration
 * 
 * Settings are fetched fresh each request to ensure instant admin updates
 */

import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

// ─── TYPES ────────────────────────────────────────────────────────────────────

export type ProviderMode = "mixed" | "ebay" | "amazon";
export type BudgetWindow = "hour" | "day";

export interface BlendRatio {
  amazon: number;
  ebay: number;
}

export interface CatalogSettings {
  // Provider mode
  catalogProviderMode: ProviderMode;
  amazonEnabled: boolean;
  ebayEnabled: boolean;
  
  // Amazon cost controls
  amazonMaxResultsPerQuery: number;
  amazonMaxCallsPerHour: number;
  amazonBudgetWindow: BudgetWindow;
  
  // Mixed mode config
  mixedAmazonFirstCount: number;
  mixedBlendRatio: BlendRatio;
  
  // Cache TTLs (seconds)
  searchCacheTtlSeconds: number;
  homeCacheTtlSeconds: number;
  offersCacheTtlSeconds: number;
  negativeCacheTtlSeconds: number;
  ebayCacheTtlSeconds: number;
  
  // Category rules
  amazonCategoryAllowlist: string[];
  enableCategoryRules: boolean;
  
  // Home rotation settings (12-hour rotating mixed feed)
  homeRotationIntervalMinutes: number;
  homeRotationMode: "timebucket" | "random";
  homeAvoidRepeatDays: number;
  homeItemsPerSection: number;
  ebayHomeCacheTtlSeconds: number;
}

// ─── DEFAULT VALUES ───────────────────────────────────────────────────────────

const DEFAULT_SETTINGS: CatalogSettings = {
  catalogProviderMode: "mixed",
  amazonEnabled: true,
  ebayEnabled: true,
  amazonMaxResultsPerQuery: 200,
  amazonMaxCallsPerHour: 100,
  amazonBudgetWindow: "hour",
  mixedAmazonFirstCount: 60,
  mixedBlendRatio: { amazon: 1, ebay: 2 },
  searchCacheTtlSeconds: 172800,  // 2 days
  homeCacheTtlSeconds: 43200,     // 12 hours (matches rotation)
  offersCacheTtlSeconds: 43200,   // 12 hours
  negativeCacheTtlSeconds: 120,   // 2 minutes
  ebayCacheTtlSeconds: 0,         // disabled
  amazonCategoryAllowlist: [
    "electronics",
    "electronics_phones",
    "electronics_computers",
    "electronics_gaming",
    "electronics_cameras",
    "electronics_audio",
  ],
  enableCategoryRules: false,
  // Home rotation settings
  homeRotationIntervalMinutes: 720,  // 12 hours
  homeRotationMode: "timebucket",
  homeAvoidRepeatDays: 7,
  homeItemsPerSection: 120,
  ebayHomeCacheTtlSeconds: 1800,     // 30 minutes
};

// ─── PARSE HELPERS ────────────────────────────────────────────────────────────

function parseJsonValue<T>(value: string | null, defaultValue: T): T {
  if (!value) return defaultValue;
  try {
    return JSON.parse(value) as T;
  } catch {
    return defaultValue;
  }
}

function parseNumber(value: string | null, defaultValue: number): number {
  if (!value) return defaultValue;
  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? defaultValue : parsed;
}

function parseBoolean(value: string | null, defaultValue: boolean): boolean {
  if (!value) return defaultValue;
  if (value === "true") return true;
  if (value === "false") return false;
  return defaultValue;
}

// ─── FETCH SETTINGS ───────────────────────────────────────────────────────────

/**
 * Fetch catalog settings from admin_settings table
 * Always fetches fresh to ensure instant admin updates
 */
export async function getCatalogSettings(supabase: SupabaseClient): Promise<CatalogSettings> {
  const keys = [
    "catalog_provider_mode",
    "amazon_enabled",
    "ebay_enabled",
    "amazon_max_results_per_query",
    "amazon_max_calls_per_hour",
    "amazon_budget_window",
    "mixed_amazon_first_count",
    "mixed_blend_ratio",
    "search_cache_ttl_seconds",
    "home_cache_ttl_seconds",
    "offers_cache_ttl_seconds",
    "negative_cache_ttl_seconds",
    "ebay_cache_ttl_seconds",
    "amazon_category_allowlist",
    "enable_category_rules",
    // Home rotation settings
    "home_rotation_interval_minutes",
    "home_rotation_mode",
    "home_avoid_repeat_days",
    "home_items_per_section",
    "ebay_home_cache_ttl_seconds",
  ];

  const { data, error } = await supabase
    .from("admin_settings")
    .select("key, value")
    .in("key", keys);

  if (error) {
    console.error("[catalogSettings] Error fetching settings:", error.message);
    return DEFAULT_SETTINGS;
  }

  // Build settings map
  const settingsMap = new Map<string, string>();
  for (const row of data || []) {
    settingsMap.set(row.key, row.value);
  }

  const get = (key: string) => settingsMap.get(key) || null;

  return {
    catalogProviderMode: parseJsonValue<ProviderMode>(get("catalog_provider_mode"), DEFAULT_SETTINGS.catalogProviderMode),
    amazonEnabled: parseBoolean(get("amazon_enabled"), DEFAULT_SETTINGS.amazonEnabled),
    ebayEnabled: parseBoolean(get("ebay_enabled"), DEFAULT_SETTINGS.ebayEnabled),
    amazonMaxResultsPerQuery: parseNumber(get("amazon_max_results_per_query"), DEFAULT_SETTINGS.amazonMaxResultsPerQuery),
    amazonMaxCallsPerHour: parseNumber(get("amazon_max_calls_per_hour"), DEFAULT_SETTINGS.amazonMaxCallsPerHour),
    amazonBudgetWindow: parseJsonValue<BudgetWindow>(get("amazon_budget_window"), DEFAULT_SETTINGS.amazonBudgetWindow),
    mixedAmazonFirstCount: parseNumber(get("mixed_amazon_first_count"), DEFAULT_SETTINGS.mixedAmazonFirstCount),
    mixedBlendRatio: parseJsonValue<BlendRatio>(get("mixed_blend_ratio"), DEFAULT_SETTINGS.mixedBlendRatio),
    searchCacheTtlSeconds: parseNumber(get("search_cache_ttl_seconds"), DEFAULT_SETTINGS.searchCacheTtlSeconds),
    homeCacheTtlSeconds: parseNumber(get("home_cache_ttl_seconds"), DEFAULT_SETTINGS.homeCacheTtlSeconds),
    offersCacheTtlSeconds: parseNumber(get("offers_cache_ttl_seconds"), DEFAULT_SETTINGS.offersCacheTtlSeconds),
    negativeCacheTtlSeconds: parseNumber(get("negative_cache_ttl_seconds"), DEFAULT_SETTINGS.negativeCacheTtlSeconds),
    ebayCacheTtlSeconds: parseNumber(get("ebay_cache_ttl_seconds"), DEFAULT_SETTINGS.ebayCacheTtlSeconds),
    amazonCategoryAllowlist: parseJsonValue<string[]>(get("amazon_category_allowlist"), DEFAULT_SETTINGS.amazonCategoryAllowlist),
    enableCategoryRules: parseBoolean(get("enable_category_rules"), DEFAULT_SETTINGS.enableCategoryRules),
    // Home rotation settings
    homeRotationIntervalMinutes: parseNumber(get("home_rotation_interval_minutes"), DEFAULT_SETTINGS.homeRotationIntervalMinutes),
    homeRotationMode: parseJsonValue<"timebucket" | "random">(get("home_rotation_mode"), DEFAULT_SETTINGS.homeRotationMode),
    homeAvoidRepeatDays: parseNumber(get("home_avoid_repeat_days"), DEFAULT_SETTINGS.homeAvoidRepeatDays),
    homeItemsPerSection: parseNumber(get("home_items_per_section"), DEFAULT_SETTINGS.homeItemsPerSection),
    ebayHomeCacheTtlSeconds: parseNumber(get("ebay_home_cache_ttl_seconds"), DEFAULT_SETTINGS.ebayHomeCacheTtlSeconds),
  };
}

// ─── EFFECTIVE MODE RESOLVER ──────────────────────────────────────────────────

export interface EffectiveMode {
  mode: ProviderMode;
  amazonActive: boolean;
  ebayActive: boolean;
  reason: string;
}

/**
 * Determine effective provider mode based on settings and request params
 */
export function getEffectiveMode(
  settings: CatalogSettings,
  requestProvider?: string,
  category?: string
): EffectiveMode {
  let mode = settings.catalogProviderMode;
  let amazonActive = settings.amazonEnabled;
  let ebayActive = settings.ebayEnabled;
  let reason = "default";

  // Request override (if provided)
  if (requestProvider && ["mixed", "ebay", "amazon"].includes(requestProvider)) {
    mode = requestProvider as ProviderMode;
    reason = "request_override";
  }

  // Category rules
  if (settings.enableCategoryRules && category) {
    const isAllowed = settings.amazonCategoryAllowlist.includes(category);
    if (!isAllowed && mode !== "ebay") {
      // Force eBay for non-allowed categories
      mode = "ebay";
      amazonActive = false;
      reason = "category_rule";
    }
  }

  // Provider toggles override mode
  if (!amazonActive && !ebayActive) {
    // Both disabled - fallback to eBay with warning
    ebayActive = true;
    mode = "ebay";
    reason = "both_disabled_fallback";
  } else if (!amazonActive) {
    mode = "ebay";
    reason = amazonActive ? reason : "amazon_disabled";
  } else if (!ebayActive) {
    mode = "amazon";
    reason = ebayActive ? reason : "ebay_disabled";
  }

  console.log(`[CATALOG_MODE] mode=${mode} amazonActive=${amazonActive} ebayActive=${ebayActive} reason=${reason}`);

  return { mode, amazonActive, ebayActive, reason };
}

// ─── UPDATE SETTING ───────────────────────────────────────────────────────────

/**
 * Update a catalog setting (admin only)
 */
export async function updateCatalogSetting(
  supabase: SupabaseClient,
  key: string,
  value: unknown,
  updatedBy?: string
): Promise<{ success: boolean; error?: string }> {
  const validKeys = [
    "catalog_provider_mode",
    "amazon_enabled",
    "ebay_enabled",
    "amazon_max_results_per_query",
    "amazon_max_calls_per_hour",
    "amazon_budget_window",
    "mixed_amazon_first_count",
    "mixed_blend_ratio",
    "search_cache_ttl_seconds",
    "home_cache_ttl_seconds",
    // Home rotation settings
    "home_rotation_interval_minutes",
    "home_rotation_mode",
    "home_avoid_repeat_days",
    "home_items_per_section",
    "ebay_home_cache_ttl_seconds",
    "offers_cache_ttl_seconds",
    "negative_cache_ttl_seconds",
    "ebay_cache_ttl_seconds",
    "amazon_category_allowlist",
    "enable_category_rules",
  ];

  if (!validKeys.includes(key)) {
    return { success: false, error: `Invalid setting key: ${key}` };
  }

  // Serialize value to string
  const serialized = typeof value === "string" ? value : JSON.stringify(value);

  const { error } = await supabase
    .from("admin_settings")
    .upsert({
      key,
      value: serialized,
      updated_at: new Date().toISOString(),
    }, { onConflict: "key" });

  if (error) {
    console.error("[catalogSettings] Error updating setting:", error.message);
    return { success: false, error: error.message };
  }

  console.log(`[catalogSettings] Updated ${key}=${serialized} by ${updatedBy || "unknown"}`);
  return { success: true };
}
