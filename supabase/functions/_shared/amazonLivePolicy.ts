/**
 * Amazon Live Policy - Smart Live + Cache Decision Engine
 * 
 * Determines whether Amazon should use live Rainforest API or cached data
 * for each request based on endpoint type, query, budget, and admin settings.
 */

// Use 'any' type to avoid importing the Supabase SDK (prevents bundle bloat)
type SupabaseClient = any;

import { CatalogSettings } from "./catalogSettings.ts";

// ─── TYPES ────────────────────────────────────────────────────────────────────

export type EndpointType = "search" | "category" | "home_section";

export type AmazonLiveReason = 
  | "live_page1"           // Live allowed for page 1
  | "live_allowed"         // Live allowed within max pages
  | "budget_exceeded"      // API budget exceeded
  | "generic_query"        // Query is generic/blocklisted
  | "query_too_short"      // Query below min length
  | "disabled"             // Amazon disabled globally
  | "live_disabled"        // Live disabled for this endpoint
  | "max_pages_exceeded"   // Beyond allowed live pages
  | "cache_only"           // Using cache only
  | "prewarm_only";        // Home sections use prewarm cache

export interface AmazonLiveSettings {
  // Per-endpoint live toggles
  amazonLiveSearchEnabled: boolean;
  amazonLiveCategoryEnabled: boolean;
  amazonLiveHomeEnabled: boolean;
  
  // Live limits
  amazonLiveMaxPages: number;
  
  // Prewarm settings
  amazonHomePrewarmEnabled: boolean;
  amazonHomePrewarmIntervalMinutes: number;
  amazonHomePrewarmMaxItemsPerSection: number;
  
  // Query filtering
  amazonQueryGenericBlocklist: string[];
  amazonLiveMinQueryLen: number;
}

export interface AmazonLiveDecision {
  useLive: boolean;
  reason: AmazonLiveReason;
  currentPage: number;
  maxPages: number;
  budgetRemaining: number | null;
  isGenericQuery: boolean;
  queryLength: number;
}

// ─── DEFAULT SETTINGS ─────────────────────────────────────────────────────────

export const DEFAULT_LIVE_SETTINGS: AmazonLiveSettings = {
  amazonLiveSearchEnabled: false,   // OFFLINE-ONLY: users never trigger live calls
  amazonLiveCategoryEnabled: false, // OFFLINE-ONLY: users never trigger live calls
  amazonLiveHomeEnabled: false,     // Home uses prewarm cache by default
  amazonLiveMaxPages: 1,         // Only page 1 is live
  amazonHomePrewarmEnabled: true,
  amazonHomePrewarmIntervalMinutes: 720,  // 12 hours
  amazonHomePrewarmMaxItemsPerSection: 200,
  amazonQueryGenericBlocklist: [
    "shoes", "clothes", "home", "house", "decor",
    "vetement", "vetements", "chaussure", "chaussures", "maison",
    "robe", "pantalon", "chemise", "all", "tout", "products"
  ],
  amazonLiveMinQueryLen: 3,
};

// ─── SETTINGS LOADER ──────────────────────────────────────────────────────────

const LIVE_SETTING_KEYS = [
  "amazon_live_search_enabled",
  "amazon_live_category_enabled",
  "amazon_live_home_enabled",
  "amazon_live_max_pages",
  "amazon_home_prewarm_enabled",
  "amazon_home_prewarm_interval_minutes",
  "amazon_home_prewarm_max_items_per_section",
  "amazon_query_generic_blocklist",
  "amazon_live_min_query_len",
];

function parseBoolean(value: string | null, defaultValue: boolean): boolean {
  if (!value) return defaultValue;
  if (value === "true") return true;
  if (value === "false") return false;
  return defaultValue;
}

function parseNumber(value: string | null, defaultValue: number): number {
  if (!value) return defaultValue;
  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? defaultValue : parsed;
}

function parseJsonValue<T>(value: string | null, defaultValue: T): T {
  if (!value) return defaultValue;
  try {
    return JSON.parse(value) as T;
  } catch {
    return defaultValue;
  }
}

export async function getAmazonLiveSettings(supabase: SupabaseClient): Promise<AmazonLiveSettings> {
  const { data, error } = await supabase
    .from("admin_settings")
    .select("key, value")
    .in("key", LIVE_SETTING_KEYS);

  if (error) {
    console.error("[amazonLivePolicy] Error fetching settings:", error.message);
    return DEFAULT_LIVE_SETTINGS;
  }

  const settingsMap = new Map<string, string>();
  for (const row of data || []) {
    settingsMap.set(row.key, row.value);
  }

  const get = (key: string) => settingsMap.get(key) || null;

  return {
    amazonLiveSearchEnabled: parseBoolean(get("amazon_live_search_enabled"), DEFAULT_LIVE_SETTINGS.amazonLiveSearchEnabled),
    amazonLiveCategoryEnabled: parseBoolean(get("amazon_live_category_enabled"), DEFAULT_LIVE_SETTINGS.amazonLiveCategoryEnabled),
    amazonLiveHomeEnabled: parseBoolean(get("amazon_live_home_enabled"), DEFAULT_LIVE_SETTINGS.amazonLiveHomeEnabled),
    amazonLiveMaxPages: parseNumber(get("amazon_live_max_pages"), DEFAULT_LIVE_SETTINGS.amazonLiveMaxPages),
    amazonHomePrewarmEnabled: parseBoolean(get("amazon_home_prewarm_enabled"), DEFAULT_LIVE_SETTINGS.amazonHomePrewarmEnabled),
    amazonHomePrewarmIntervalMinutes: parseNumber(get("amazon_home_prewarm_interval_minutes"), DEFAULT_LIVE_SETTINGS.amazonHomePrewarmIntervalMinutes),
    amazonHomePrewarmMaxItemsPerSection: parseNumber(get("amazon_home_prewarm_max_items_per_section"), DEFAULT_LIVE_SETTINGS.amazonHomePrewarmMaxItemsPerSection),
    amazonQueryGenericBlocklist: parseJsonValue<string[]>(get("amazon_query_generic_blocklist"), DEFAULT_LIVE_SETTINGS.amazonQueryGenericBlocklist),
    amazonLiveMinQueryLen: parseNumber(get("amazon_live_min_query_len"), DEFAULT_LIVE_SETTINGS.amazonLiveMinQueryLen),
  };
}

// ─── DECISION ENGINE ──────────────────────────────────────────────────────────

export interface LiveDecisionInput {
  endpoint: EndpointType;
  query: string;
  amazonPage: number;  // Current Amazon page (from cursor)
  amazonEnabled: boolean;
  budgetAllowed: boolean;
  budgetRemaining: number | null;
  liveSettings: AmazonLiveSettings;
  requestId?: string;
}

/**
 * Determine whether to use live Rainforest API for this request
 */
export function shouldUseAmazonLive(input: LiveDecisionInput): AmazonLiveDecision {
  const {
    endpoint,
    query,
    amazonPage,
    amazonEnabled,
    budgetAllowed,
    budgetRemaining,
    liveSettings,
    requestId,
  } = input;

  const normalizedQuery = query.toLowerCase().trim();
  const queryLength = normalizedQuery.length;
  
  // Check if query is in generic blocklist (case-insensitive)
  const isGenericQuery = liveSettings.amazonQueryGenericBlocklist.some(
    blocked => normalizedQuery === blocked.toLowerCase() || 
               normalizedQuery.includes(blocked.toLowerCase())
  );

  const baseDecision: AmazonLiveDecision = {
    useLive: false,
    reason: "cache_only",
    currentPage: amazonPage,
    maxPages: liveSettings.amazonLiveMaxPages,
    budgetRemaining,
    isGenericQuery,
    queryLength,
  };

  // 1. Check if Amazon is globally enabled
  if (!amazonEnabled) {
    return { ...baseDecision, reason: "disabled" };
  }

  // 2. Check endpoint-specific live toggle
  const endpointLiveEnabled = 
    endpoint === "search" ? liveSettings.amazonLiveSearchEnabled :
    endpoint === "category" ? liveSettings.amazonLiveCategoryEnabled :
    liveSettings.amazonLiveHomeEnabled;

  if (!endpointLiveEnabled) {
    const reason: AmazonLiveReason = endpoint === "home_section" ? "prewarm_only" : "live_disabled";
    return { ...baseDecision, reason };
  }

  // 3. Check query length
  if (queryLength < liveSettings.amazonLiveMinQueryLen) {
    return { ...baseDecision, reason: "query_too_short" };
  }

  // 4. Check generic query blocklist
  if (isGenericQuery) {
    return { ...baseDecision, reason: "generic_query" };
  }

  // 5. Check API budget
  if (!budgetAllowed) {
    return { ...baseDecision, reason: "budget_exceeded" };
  }

  // 6. Check page limit
  if (amazonPage > liveSettings.amazonLiveMaxPages) {
    return { ...baseDecision, reason: "max_pages_exceeded" };
  }

  // All checks passed - use live API
  const reason: AmazonLiveReason = amazonPage === 1 ? "live_page1" : "live_allowed";
  
  console.log(`[AMAZON_LIVE] requestId=${requestId || "?"} endpoint=${endpoint} q="${query}" page=${amazonPage} decision=LIVE reason=${reason}`);

  return {
    useLive: true,
    reason,
    currentPage: amazonPage,
    maxPages: liveSettings.amazonLiveMaxPages,
    budgetRemaining,
    isGenericQuery,
    queryLength,
  };
}

// ─── CACHE KEY BUILDER ────────────────────────────────────────────────────────

const AMAZON_CACHE_VERSION = "v2";

export interface AmazonCacheKeyParams {
  query: string;
  categoryKey?: string | null;
  page: number;
  filters?: Record<string, unknown>;
  sort?: string;
}

export function buildAmazonCacheKey(params: AmazonCacheKeyParams): string {
  const parts = [
    "amazon",
    AMAZON_CACHE_VERSION,
    `q:${params.query.toLowerCase().trim()}`,
    `cat:${params.categoryKey || "all"}`,
    `p:${params.page}`,
  ];

  if (params.sort && params.sort !== "relevance") {
    parts.push(`sort:${params.sort}`);
  }

  if (params.filters) {
    const filterStr = Object.entries(params.filters)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join(",");
    if (filterStr) {
      parts.push(`f:${filterStr}`);
    }
  }

  return parts.join("|");
}

// ─── LOGGING ──────────────────────────────────────────────────────────────────

export interface MixLogParams {
  mode: string;
  query: string;
  amazonLiveUsed: boolean;
  amazonLiveReason: AmazonLiveReason;
  amazonReturned: number;
  ebayReturned: number;
  budgetRemaining: number | null;
  amazonCacheHit: boolean;
  requestId?: string;
}

export function logMixerRequest(params: MixLogParams): void {
  console.log(`[MIX] mode=${params.mode} q="${params.query}" amazonLiveUsed=${params.amazonLiveUsed} amazonLiveReason=${params.amazonLiveReason} amazonReturned=${params.amazonReturned} ebayReturned=${params.ebayReturned} budgetRemaining=${params.budgetRemaining ?? "?"} cacheHit=${params.amazonCacheHit}`);
}
