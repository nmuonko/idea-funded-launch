// Settings cache for frequently accessed global configuration
// TTL: 15 minutes fresh, 1 hour stale-while-revalidate
// Optimized for 1000+ concurrent users

import { VehiclePricingTiers, parseTiers } from "./vehiclePricing.ts";

interface CachedSettings {
  exchangeRate: number;
  markupPercent: number;
  vehicleMarkupPercent: number;  // Vehicle-specific markup
  shippingBaseFeeUsd: number;
  shippingPercent: number;
  serviceFeePercent: number;
  minServiceFeeUsd: number;
  vehiclePricingTiers: VehiclePricingTiers;
  fetchedAt: number;
}

let settingsCache: CachedSettings | null = null;
let refreshInProgress = false;

// OPTIMIZED FOR 5K-10K USERS: In-memory TTL cache to reduce DB pressure
// Edge function instances live ~5-10 min; 60s cache eliminates ~95% of settings queries
const CACHE_TTL_MS = 60 * 1000;           // 60 seconds fresh — skip DB entirely
const STALE_TTL_MS = 5 * 60 * 1000;      // 5 minutes stale-while-revalidate

/**
 * Get cached settings with stale-while-revalidate pattern
 * - If fresh (< 15 min): return immediately
 * - If stale (15 min - 1 hour): return immediately, trigger background refresh
 * - If expired (> 1 hour): fetch fresh
 */
export async function getCachedSettings(supabase: any): Promise<CachedSettings> {
  const now = Date.now();
  
  // Return cached if fresh
  if (settingsCache && (now - settingsCache.fetchedAt) < CACHE_TTL_MS) {
    return settingsCache;
  }

  // Return stale but trigger background refresh
  if (settingsCache && (now - settingsCache.fetchedAt) < STALE_TTL_MS) {
    // Only start refresh if not already in progress
    if (!refreshInProgress) {
      refreshInProgress = true;
      refreshSettingsInBackground(supabase).finally(() => {
        refreshInProgress = false;
      });
    }
    return settingsCache;
  }

  // Cache expired or empty - fetch fresh (blocking)
  return await fetchFreshSettings(supabase);
}

/**
 * Fetch fresh settings from database
 */
async function fetchFreshSettings(supabase: any): Promise<CachedSettings> {
  const now = Date.now();
  
  // Fetch fresh settings - select only needed columns
  const { data: settings, error } = await supabase
    .from('settings')
    .select('exchange_rate_usd_to_cdf, markup_percent, global_markup_percent, shipping_base_fee_usd, shipping_percent, service_fee_percent, min_service_fee_usd, category_markups, vehicle_pricing_tiers')
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error('[settings-cache] Error fetching settings:', error.message);
    
    // If we have stale data, return it rather than failing
    if (settingsCache) {
      console.warn('[settings-cache] Using stale cache due to fetch error');
      return settingsCache;
    }
  }

  // Parse values with defaults - all percentages stored as whole numbers (10 = 10%)
  // DO NOT convert values ≤1 - that incorrectly changes 1% to 100%
  const markupVal = settings?.markup_percent ?? settings?.global_markup_percent ?? 15;
  const markupPercent = markupVal; // Use as-is, 1 = 1%
  
  // Vehicle markup from category_markups.vehicles (default to general markup)
  const categoryMarkups = (settings?.category_markups || {}) as Record<string, number>;
  const vehicleMarkupRaw = categoryMarkups.vehicles ?? markupPercent;
  const vehicleMarkupPercent = vehicleMarkupRaw; // Use as-is, 1 = 1%
  
  // shipping_percent is stored as whole number (10 = 10%), same as markup
  const shippingPercent = settings?.shipping_percent ?? 10;
  
  // service_fee_percent stored as whole number (12 = 12%)
  const serviceFeePercent = settings?.service_fee_percent ?? 0.12;
  
  // CRITICAL: Get exchange rate from DB - do NOT use hardcoded fallback
  const dbExchangeRate = settings?.exchange_rate_usd_to_cdf;
  if (!dbExchangeRate || dbExchangeRate <= 0) {
    console.error('[settings-cache] CRITICAL: No exchange rate in settings table! Using emergency fallback.');
  }
  
  settingsCache = {
    // Use DB value or log error - never silently use wrong rate
    exchangeRate: dbExchangeRate || 2500, // Emergency fallback only if DB is empty
    markupPercent,
    vehicleMarkupPercent,
    shippingBaseFeeUsd: settings?.shipping_base_fee_usd ?? 20,
    shippingPercent,
    serviceFeePercent,
    minServiceFeeUsd: settings?.min_service_fee_usd ?? 5,
    vehiclePricingTiers: parseTiers(settings?.vehicle_pricing_tiers),
    fetchedAt: now,
  };
  
  console.log('[settings-cache] Cached settings:', settingsCache);

  return settingsCache;
}

/**
 * Background refresh - non-blocking
 */
async function refreshSettingsInBackground(supabase: any): Promise<void> {
  try {
    await fetchFreshSettings(supabase);
    console.log('[settings-cache] Background refresh completed');
  } catch (e) {
    console.error('[settings-cache] Background refresh failed:', e);
  }
}

// Invalidate cache (call after admin updates settings)
export function invalidateSettingsCache(): void {
  settingsCache = null;
  refreshInProgress = false;
}

// Round to 2 decimals - shared utility
export const round2 = (n: number): number => Math.round(n * 100) / 100;