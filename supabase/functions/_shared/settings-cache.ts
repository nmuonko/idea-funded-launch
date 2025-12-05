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

  settingsCache = {
    exchangeRate: settings?.exchange_rate_usd_to_cdf ?? 2800,
    markupPercent: settings?.markup_percent ?? settings?.global_markup_percent ?? 15,
    shippingBaseFeeUsd: settings?.shipping_base_fee_usd ?? 20,
    shippingPercent: settings?.shipping_percent ?? 0.10,
    fetchedAt: now,
  };

  return settingsCache;
}

// Invalidate cache (call after admin updates settings)
export function invalidateSettingsCache(): void {
  settingsCache = null;
}

// Round to 2 decimals - shared utility
export const round2 = (n: number): number => Math.round(n * 100) / 100;
