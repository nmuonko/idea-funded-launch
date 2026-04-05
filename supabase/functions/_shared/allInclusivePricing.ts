/**
 * All-Inclusive Pricing for Mobile Display
 * 
 * Transforms raw base prices into all-inclusive display prices
 * that include markup + shipping fees.
 * 
 * Used by catalog-home and catalog-search to ensure the RN app
 * shows the FINAL price the customer will pay — preventing
 * price inflation shock when items are added to cart.
 */

interface PricingSettings {
  markupPercent: number;
  shippingBaseFeeUsd: number;
  shippingPercent: number;
}

let cachedPricingSettings: PricingSettings | null = null;
let cachedAt = 0;
const CACHE_TTL_MS = 60_000; // 1 minute

/**
 * Load pricing settings from DB (with in-memory cache)
 */
export async function loadPricingSettings(): Promise<PricingSettings> {
  const now = Date.now();
  if (cachedPricingSettings && (now - cachedAt) < CACHE_TTL_MS) {
    return cachedPricingSettings;
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceRoleKey) {
    console.warn("[ALL_INCLUSIVE] Missing env vars, using defaults");
    return { markupPercent: 30, shippingBaseFeeUsd: 20, shippingPercent: 10 };
  }

  try {
    const res = await fetch(
      `${supabaseUrl}/rest/v1/settings?select=markup_percent,global_markup_percent,shipping_base_fee_usd,shipping_percent&limit=1`,
      {
        headers: {
          apikey: serviceRoleKey,
          Authorization: `Bearer ${serviceRoleKey}`,
          Accept: "application/vnd.pgrst.object+json",
        },
      }
    );

    if (!res.ok) {
      console.error(`[ALL_INCLUSIVE] settings fetch failed: ${res.status}`);
      return cachedPricingSettings || { markupPercent: 30, shippingBaseFeeUsd: 20, shippingPercent: 10 };
    }

    const row = await res.json();
    cachedPricingSettings = {
      markupPercent: row?.markup_percent ?? row?.global_markup_percent ?? 30,
      shippingBaseFeeUsd: row?.shipping_base_fee_usd ?? 20,
      shippingPercent: row?.shipping_percent ?? 10,
    };
    cachedAt = now;
    console.log(`[ALL_INCLUSIVE] settings loaded: markup=${cachedPricingSettings.markupPercent}% shippingBase=$${cachedPricingSettings.shippingBaseFeeUsd} shippingPct=${cachedPricingSettings.shippingPercent}%`);
    return cachedPricingSettings;
  } catch (err) {
    console.error(`[ALL_INCLUSIVE] settings load error: ${err}`);
    return cachedPricingSettings || { markupPercent: 30, shippingBaseFeeUsd: 20, shippingPercent: 10 };
  }
}

/**
 * Compute all-inclusive price from base price.
 * Formula: base + (base * markup%) + shippingBase + (base * shipping%)
 */
export function computeAllInclusivePrice(basePriceUsd: number, settings: PricingSettings): number {
  if (!basePriceUsd || basePriceUsd <= 0) return basePriceUsd;

  const markupRate = settings.markupPercent > 1 ? settings.markupPercent / 100 : settings.markupPercent;
  const shippingRate = settings.shippingPercent > 1 ? settings.shippingPercent / 100 : settings.shippingPercent;

  const markup = basePriceUsd * markupRate;
  const shipping = settings.shippingBaseFeeUsd + (basePriceUsd * shippingRate);
  const total = basePriceUsd + markup + shipping;

  return Math.round(total * 100) / 100;
}

/**
 * Transform an array of catalog items to use all-inclusive pricing.
 * Mutates price_usd/priceUsd to all-inclusive values.
 * Adds base_price_usd, fees_included, pricing_mode metadata.
 * 
 * Skips vehicle items (they use tiered pricing separately).
 */
export function applyAllInclusivePricingToItems<T extends Record<string, unknown>>(
  items: T[],
  settings: PricingSettings,
): T[] {
  return items.map(item => {
    const rawPrice = (item.price_usd ?? item.priceUsd) as number | null;
    if (!rawPrice || rawPrice <= 0) return item;

    // Skip vehicles — they have their own tiered pricing
    const provider = (item.provider as string || "").toLowerCase();
    if (provider === "cargurus" || provider === "carvana") return item;
    const title = ((item.title as string) || "").toLowerCase();
    if (/\b(car|truck|suv|sedan|van|motorcycle|vehicle)\b/i.test(title) && rawPrice > 3000) return item;

    const allInclusivePrice = computeAllInclusivePrice(rawPrice, settings);

    return {
      ...item,
      base_price_usd: rawPrice,
      basePriceUsd: rawPrice,
      price_usd: allInclusivePrice,
      priceUsd: allInclusivePrice,
      fees_included: true,
      is_all_inclusive_display: true,
      pricing_mode: "all_inclusive",
    };
  });
}
