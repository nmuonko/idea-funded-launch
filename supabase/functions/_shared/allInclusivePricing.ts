/**
 * All-Inclusive Pricing for Mobile Display
 * 
 * Transforms raw base prices into all-inclusive display prices
 * that include markup + shipping fees.
 * 
 * For regular products: base + markup% + weight-based shipping (with buffer)
 * For vehicles (cargurus/carvana): tiered percentage model via vehiclePricing.ts
 * 
 * Used by catalog-home, catalog-search, catalog-category, catalog-product,
 * and recently-viewed-list to ensure the RN app shows the FINAL price
 * the customer will pay — preventing price inflation shock when items
 * are added to cart.
 */

import { calculateVehicleFinalPrice, parseTiers, type VehiclePricingTiers } from "./vehiclePricing.ts";

interface ShippingCategoryRow {
  key: string;
  est_weight_kg: number;
  flat_shipping_usd: number | null;
  shipping_buffer_percent: number;
  requires_manual_quote: boolean;
}

interface PricingSettings {
  markupPercent: number;
  // Legacy (fallback)
  shippingBaseFeeUsd: number;
  shippingPercent: number;
  // New weight-based
  shippingRatePerKg: number;
  shippingCategories: ShippingCategoryRow[];
  vehiclePricingTiers: VehiclePricingTiers | null;
}

// Re-export for callers
export type { PricingSettings };

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
    return {
      markupPercent: 30, shippingBaseFeeUsd: 20, shippingPercent: 10,
      shippingRatePerKg: 20, shippingCategories: [], vehiclePricingTiers: null,
    };
  }

  try {
    // Fetch settings + shipping categories in parallel
    const [settingsRes, categoriesRes] = await Promise.all([
      fetch(
        `${supabaseUrl}/rest/v1/settings?select=markup_percent,global_markup_percent,shipping_base_fee_usd,shipping_percent,shipping_rate_per_kg,vehicle_pricing_tiers&limit=1`,
        {
          headers: {
            apikey: serviceRoleKey,
            Authorization: `Bearer ${serviceRoleKey}`,
            Accept: "application/vnd.pgrst.object+json",
          },
        }
      ),
      fetch(
        `${supabaseUrl}/rest/v1/shipping_item_types?select=key,est_weight_kg,flat_shipping_usd,shipping_buffer_percent,requires_manual_quote&active=eq.true`,
        {
          headers: {
            apikey: serviceRoleKey,
            Authorization: `Bearer ${serviceRoleKey}`,
          },
        }
      ),
    ]);

    if (!settingsRes.ok) {
      console.error(`[ALL_INCLUSIVE] settings fetch failed: ${settingsRes.status}`);
      return cachedPricingSettings || {
        markupPercent: 30, shippingBaseFeeUsd: 20, shippingPercent: 10,
        shippingRatePerKg: 20, shippingCategories: [], vehiclePricingTiers: null,
      };
    }

    const row = await settingsRes.json();
    const categories: ShippingCategoryRow[] = categoriesRes.ok ? await categoriesRes.json() : [];

    cachedPricingSettings = {
      markupPercent: row?.markup_percent ?? row?.global_markup_percent ?? 30,
      shippingBaseFeeUsd: row?.shipping_base_fee_usd ?? 20,
      shippingPercent: row?.shipping_percent ?? 10,
      shippingRatePerKg: row?.shipping_rate_per_kg ?? 20,
      shippingCategories: categories,
      vehiclePricingTiers: row?.vehicle_pricing_tiers ? parseTiers(row.vehicle_pricing_tiers) : null,
    };
    cachedAt = now;
    console.log(`[ALL_INCLUSIVE] settings loaded: markup=${cachedPricingSettings.markupPercent}% ratePerKg=$${cachedPricingSettings.shippingRatePerKg} categories=${categories.length} vehicleTiers=${cachedPricingSettings.vehiclePricingTiers ? 'loaded' : 'defaults'}`);
    return cachedPricingSettings;
  } catch (err) {
    console.error(`[ALL_INCLUSIVE] settings load error: ${err}`);
    return cachedPricingSettings || {
      markupPercent: 30, shippingBaseFeeUsd: 20, shippingPercent: 10,
      shippingRatePerKg: 20, shippingCategories: [], vehiclePricingTiers: null,
    };
  }
}

// Default category for items that don't match any specific category
// NOTE: This is only used when shippingCategories are loaded from DB.
// When no categories exist, the legacy fallback (flat+percent) is used instead.
const DEFAULT_CATEGORY: ShippingCategoryRow = {
  key: 'console_medium',
  est_weight_kg: 6,
  flat_shipping_usd: null,
  shipping_buffer_percent: 25,
  requires_manual_quote: false,
};

/**
 * Detect shipping category from item data using keyword matching
 */
function detectShippingCategory(item: Record<string, unknown>, categories: ShippingCategoryRow[]): ShippingCategoryRow {
  if (categories.length === 0) return DEFAULT_CATEGORY;

  const title = ((item.title as string) || "").toLowerCase();
  const categoryKey = ((item.unified_category ?? item.category_key ?? item.categoryKey) as string || "").toLowerCase();

  // Direct category_key match
  const directMatch = categories.find(c => c.key === categoryKey);
  if (directMatch) return directMatch;

  // Keyword-based matching — maps keywords to category keys (current DB keys)
  const catMap: [string[], string[]][] = [
    // Phone / Camera (flat $50)
    [['phone_camera'], ['phone', 'iphone', 'samsung galaxy s', 'pixel', 'motorola', 'oneplus', 'camera', 'gopro', 'dslr', 'mirrorless']],
    // Small accessories (weight-based, cheap shipping)
    [['small_accessories'], ['earbuds', 'airpods', 'earbud', 'smartwatch', 'apple watch', 'charger', 'cable', 'adapter', 'power bank', 'memory card', 'usb', 'dongle', 'stylus', 'airtag']],
    // Laptop (flat $80)
    [['laptop'], ['laptop', 'macbook', 'chromebook', 'notebook', 'thinkpad', 'surface laptop', 'surface pro', 'surface book']],
    // Tablet (flat $40)
    [['tablet'], ['ipad', 'tablet', 'galaxy tab', 'fire hd', 'kindle']],
    // Clothes / Shoes
    [['clothes_shoes'], ['shirt', 'dress', 'shoes', 'sneakers', 'jacket', 'pants', 'jeans', 'hoodie', 'sweater', 'clothing', 'apparel', 'boots', 'sandals', 'handbag', 'backpack']],
    // Console / Medium electronics
    [['console_medium'], ['playstation', 'xbox', 'nintendo', 'ps5', 'ps4', 'switch', 'printer', 'monitor', 'speaker', 'projector', 'router', 'steam deck']],
    // TV / Large appliance / Furniture
    [['tv_large_appliance'], ['tv', 'television', 'refrigerator', 'washer', 'dryer', 'furniture', 'sofa', 'couch', 'dishwasher', 'oven', 'microwave']],
  ];

  for (const [catKeys, keywords] of catMap) {
    if (keywords.some(kw => title.includes(kw))) {
      for (const catKey of catKeys) {
        const match = categories.find(c => c.key === catKey);
        if (match) return match;
      }
    }
  }

  // Fallback to console_medium from DB or default
  return categories.find(c => c.key === 'console_medium') || DEFAULT_CATEGORY;
}

/**
 * Compute weight-based shipping for a single item
 */
function computeWeightBasedShipping(category: ShippingCategoryRow, ratePerKg: number): number {
  if (category.requires_manual_quote) return 0;

  let baseShipping: number;
  if (category.flat_shipping_usd != null && category.flat_shipping_usd > 0) {
    baseShipping = category.flat_shipping_usd;
  } else {
    baseShipping = category.est_weight_kg * ratePerKg;
  }

  const bufferMultiplier = 1 + (category.shipping_buffer_percent / 100);
  return Math.round(baseShipping * bufferMultiplier * 100) / 100;
}

/**
 * Compute all-inclusive price from base price (regular products).
 * Uses weight-based shipping when categories are available.
 */
export function computeAllInclusivePrice(
  basePriceUsd: number,
  settings: PricingSettings,
  item?: Record<string, unknown>,
): number {
  if (!basePriceUsd || basePriceUsd <= 0) return basePriceUsd;

  const markupRate = settings.markupPercent > 1 ? settings.markupPercent / 100 : settings.markupPercent;
  const markup = basePriceUsd * markupRate;

  let shipping: number;
  if (settings.shippingCategories.length > 0 && item) {
    const category = detectShippingCategory(item, settings.shippingCategories);
    shipping = computeWeightBasedShipping(category, settings.shippingRatePerKg);
  } else {
    // Legacy fallback
    const shippingRate = settings.shippingPercent > 1 ? settings.shippingPercent / 100 : settings.shippingPercent;
    shipping = settings.shippingBaseFeeUsd + (basePriceUsd * shippingRate);
  }

  const total = basePriceUsd + markup + shipping;
  return Math.round(total * 100) / 100;
}

/**
 * Check if an item is a vehicle based on provider or title heuristics.
 */
function isVehicleItem(item: Record<string, unknown>): boolean {
  const provider = ((item.provider as string) || "").toLowerCase();
  if (provider === "cargurus" || provider === "carvana") return true;
  const category = ((item.unified_category ?? item.unifiedCategory ?? item.category_key ?? item.categoryKey) as string || "").toLowerCase();
  if (category === "vehicles" || category === "cars" || category === "cars_trucks") return true;
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
 * Regular products: markup + weight-based shipping
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

    // Regular products use markup + weight-based shipping
    const allInclusivePrice = computeAllInclusivePrice(rawPrice, settings, item);

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
