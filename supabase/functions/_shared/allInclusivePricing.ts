/**
 * All-Inclusive Pricing for Mobile Display
 * 
 * Transforms raw base prices into all-inclusive display prices
 * that include markup + shipping fees.
 * 
 * For regular products: base + markup% + shippingBase + shipping%
 * For vehicles (cargurus/carvana): tiered percentage model via vehiclePricing.ts
 * 
 * Used by catalog-home, catalog-search, catalog-category, catalog-product,
 * and recently-viewed-list to ensure the RN app shows the FINAL price
 * the customer will pay — preventing price inflation shock when items
 * are added to cart.
 */

import { calculateVehicleFinalPrice, parseTiers, type VehiclePricingTiers } from "./vehiclePricing.ts";

interface PricingSettings {
  markupPercent: number;
  shippingBaseFeeUsd: number;
  shippingPercent: number;
  vehiclePricingTiers: VehiclePricingTiers | null;
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
    return { markupPercent: 30, shippingBaseFeeUsd: 20, shippingPercent: 10, vehiclePricingTiers: null };
  }

  try {
    const res = await fetch(
      `${supabaseUrl}/rest/v1/settings?select=markup_percent,global_markup_percent,shipping_base_fee_usd,shipping_percent,vehicle_pricing_tiers&limit=1`,
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
      return cachedPricingSettings || { markupPercent: 30, shippingBaseFeeUsd: 20, shippingPercent: 10, vehiclePricingTiers: null };
    }

    const row = await res.json();
    cachedPricingSettings = {
      markupPercent: row?.markup_percent ?? row?.global_markup_percent ?? 30,
      shippingBaseFeeUsd: row?.shipping_base_fee_usd ?? 20,
      shippingPercent: row?.shipping_percent ?? 10,
      vehiclePricingTiers: row?.vehicle_pricing_tiers ? parseTiers(row.vehicle_pricing_tiers) : null,
    };
    cachedAt = now;
    console.log(`[ALL_INCLUSIVE] settings loaded: markup=${cachedPricingSettings.markupPercent}% shippingBase=$${cachedPricingSettings.shippingBaseFeeUsd} shippingPct=${cachedPricingSettings.shippingPercent}% vehicleTiers=${cachedPricingSettings.vehiclePricingTiers ? 'loaded' : 'defaults'}`);
    return cachedPricingSettings;
  } catch (err) {
    console.error(`[ALL_INCLUSIVE] settings load error: ${err}`);
    return cachedPricingSettings || { markupPercent: 30, shippingBaseFeeUsd: 20, shippingPercent: 10, vehiclePricingTiers: null };
  }
}

/**
 * Compute all-inclusive price from base price (regular products).
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
 * Check if an item is a vehicle based on provider or title heuristics.
 */
function isVehicleItem(item: Record<string, unknown>): boolean {
  const provider = ((item.provider as string) || "").toLowerCase();
  if (provider === "cargurus" || provider === "carvana") return true;
  // Category-based detection (most reliable for eBay vehicles)
  const category = ((item.unified_category ?? item.unifiedCategory ?? item.category_key ?? item.categoryKey) as string || "").toLowerCase();
  if (category === "vehicles" || category === "cars" || category === "cars_trucks") return true;
  // Title-based heuristic for vehicle items from other providers
  const title = ((item.title as string) || "").toLowerCase();
  const rawPrice = (item.price_usd ?? item.priceUsd) as number | null;
  if (rawPrice && rawPrice > 3000 && /\b(car|truck|suv|sedan|van|motorcycle|vehicle)\b/i.test(title)) return true;
  return false;
}

/**
 * Transform an array of catalog items to use all-inclusive pricing.
 * Mutates price_usd/priceUsd to all-inclusive values.
 * Adds base_price_usd, fees_included, pricing_mode metadata.
 * 
 * Regular products: markup + shipping formula
 * Vehicles: tiered percentage model (same as cart auto-pricer)
 */
export function applyAllInclusivePricingToItems<T extends Record<string, unknown>>(
  items: T[],
  settings: PricingSettings,
): T[] {
  return items.map(item => {
    // Skip items that already have all-inclusive pricing applied (prevent double-pricing)
    if (item.fees_included === true || item.is_all_inclusive_display === true) return item;

    const rawPrice = (item.price_usd ?? item.priceUsd) as number | null;
    if (!rawPrice || rawPrice <= 0) return item;

    // Vehicle items use tiered pricing
    if (isVehicleItem(item)) {
      const tiers = settings.vehiclePricingTiers || parseTiers(null);
      const vp = calculateVehicleFinalPrice(rawPrice, 'running', 'roro', tiers);
      return {
        ...item,
        base_price_usd: rawPrice,
        basePriceUsd: rawPrice,
        price_usd: vp.finalPriceUsd,
        priceUsd: vp.finalPriceUsd,
        fees_included: true,
        is_all_inclusive_display: true,
        pricing_mode: "vehicle_tiered",
        vehicle_tier_percent: vp.tierPercent,
        vehicle_total_percent: vp.totalPercent,
      };
    }

    // Regular products use markup + shipping formula
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
