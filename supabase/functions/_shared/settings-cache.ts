// Settings cache for frequently accessed global configuration
// TTL: 5 minutes to reduce database calls

interface CachedSettings {
  exchangeRate: number;
  markupPercent: number;
  shippingBaseFeeUsd: number;
  shippingPercent: number;
  fetchedAt: number;
}

let settingsCache: CachedSettings | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export async function getCachedSettings(supabase: any): Promise<CachedSettings> {
  const now = Date.now();
  
  // Return cached if valid
  if (settingsCache && (now - settingsCache.fetchedAt) < CACHE_TTL_MS) {
    return settingsCache;
  }

  // Fetch fresh settings - select only needed columns
  const { data: settings, error } = await supabase
    .from('settings')
    .select('exchange_rate_usd_to_cdf, markup_percent, global_markup_percent, shipping_base_fee_usd, shipping_percent')
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error('[settings-cache] Error fetching settings:', error.message);
  }

  // Parse values with defaults - shipping_percent stored as decimal (0.10 = 10%)
  const markupVal = settings?.markup_percent ?? settings?.global_markup_percent ?? 15;
  // If markup is stored as decimal (e.g., 0.15), convert to percentage
  const markupPercent = markupVal < 1 ? markupVal * 100 : markupVal;
  
  // shipping_percent is stored as decimal (0.10 = 10%), keep as decimal for calculations
  const shippingPercent = settings?.shipping_percent ?? 0.10;
  
  settingsCache = {
    exchangeRate: settings?.exchange_rate_usd_to_cdf ?? 2800,
    markupPercent,
    shippingBaseFeeUsd: settings?.shipping_base_fee_usd ?? 20,
    shippingPercent,
    fetchedAt: now,
  };
  
  console.log('[settings-cache] Cached settings:', settingsCache);

  return settingsCache;
}

// Invalidate cache (call after admin updates settings)
export function invalidateSettingsCache(): void {
  settingsCache = null;
}

// Round to 2 decimals - shared utility
export const round2 = (n: number): number => Math.round(n * 100) / 100;
