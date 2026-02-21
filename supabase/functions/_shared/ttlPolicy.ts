/**
 * TTL Policy Helper
 * Resolves global + per-category TTL settings for the DB-first catalog system.
 * Uses 60-second in-memory cache to avoid DB hits on every request.
 */

type SupabaseClient = any;

export interface TtlPolicy {
  maxItemAgeDays: number;
  priceRefreshDays: number;
  availabilityRefreshDays: number;
  dbMinResults: number;
  enabled: boolean;
}

const DEFAULTS: TtlPolicy = {
  maxItemAgeDays: 30,
  priceRefreshDays: 3,
  availabilityRefreshDays: 3,
  dbMinResults: 5,
  enabled: true,
};

// ─── IN-MEMORY CACHE (60s) ────────────────────────────────────────────────────

const CACHE_TTL_MS = 60_000;

let globalCache: { value: TtlPolicy; expiresAt: number } | null = null;
const categoryCache = new Map<string, { value: TtlPolicy; expiresAt: number }>();

function parseNum(val: string | null | undefined, def: number): number {
  if (!val) return def;
  const n = parseInt(val, 10);
  return isNaN(n) ? def : n;
}

/**
 * Fetch global TTL settings from admin_settings
 */
async function getGlobalPolicy(supabase: SupabaseClient): Promise<TtlPolicy> {
  if (globalCache && Date.now() < globalCache.expiresAt) {
    return globalCache.value;
  }

  const keys = [
    "global_max_item_age_days",
    "global_price_refresh_days",
    "global_availability_refresh_days",
    "db_search_min_results",
  ];

  const { data, error } = await supabase
    .from("admin_settings")
    .select("key, value")
    .in("key", keys);

  if (error) {
    console.error("[ttlPolicy] Error fetching global settings:", error.message);
    return DEFAULTS;
  }

  const map = new Map<string, string>();
  for (const row of data || []) {
    map.set(row.key, row.value);
  }

  const policy: TtlPolicy = {
    maxItemAgeDays: parseNum(map.get("global_max_item_age_days"), DEFAULTS.maxItemAgeDays),
    priceRefreshDays: parseNum(map.get("global_price_refresh_days"), DEFAULTS.priceRefreshDays),
    availabilityRefreshDays: parseNum(map.get("global_availability_refresh_days"), DEFAULTS.availabilityRefreshDays),
    dbMinResults: parseNum(map.get("db_search_min_results"), DEFAULTS.dbMinResults),
    enabled: true,
  };

  globalCache = { value: policy, expiresAt: Date.now() + CACHE_TTL_MS };
  return policy;
}

/**
 * Resolve TTL policy for a specific category.
 * Per-category overrides take precedence over global settings.
 * NULL fields in the override = inherit global.
 */
export async function getTtlPolicy(
  supabase: SupabaseClient,
  categoryKey?: string | null
): Promise<TtlPolicy> {
  const global = await getGlobalPolicy(supabase);

  if (!categoryKey) return global;

  // Check category cache
  const cached = categoryCache.get(categoryKey);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.value;
  }

  // Fetch override
  const { data: override } = await supabase
    .from("catalog_category_ttl")
    .select("*")
    .eq("category_key", categoryKey)
    .maybeSingle();

  if (!override) {
    // No override — cache the global result for this category
    categoryCache.set(categoryKey, { value: global, expiresAt: Date.now() + CACHE_TTL_MS });
    return global;
  }

  const merged: TtlPolicy = {
    maxItemAgeDays: override.max_item_age_days ?? global.maxItemAgeDays,
    priceRefreshDays: override.price_refresh_days ?? global.priceRefreshDays,
    availabilityRefreshDays: override.availability_refresh_days ?? global.availabilityRefreshDays,
    dbMinResults: override.db_min_results ?? global.dbMinResults,
    enabled: override.enabled ?? true,
  };

  categoryCache.set(categoryKey, { value: merged, expiresAt: Date.now() + CACHE_TTL_MS });
  return merged;
}

/**
 * Invalidate all TTL policy caches (call after admin updates)
 */
export function invalidateTtlPolicyCache(): void {
  globalCache = null;
  categoryCache.clear();
  console.log("[ttlPolicy] Cache invalidated");
}
