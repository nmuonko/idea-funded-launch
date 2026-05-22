/**
 * Refresh-tier classifier for the price-refresh + price-lock system.
 *
 * Tiers (highest priority first):
 *   cart        — currently sitting in an active cart
 *   hot         — hot product (fixed price, but stock check is still useful)
 *   electronics — phones, laptops, cameras, consoles
 *   normal      — default
 *   cold        — no clicks, no carts, no views in a long time
 *   vehicle     — never auto-refresh; admin approval only
 *
 * Settings come from `price_validation_settings`.
 */

export type RefreshTier = "cart" | "hot" | "electronics" | "normal" | "cold" | "vehicle";

export interface PriceValidationSettings {
  electronics_refresh_minutes: number;
  cart_item_refresh_minutes: number;
  hot_item_refresh_minutes: number;
  normal_refresh_minutes: number;
  cold_refresh_minutes: number;
  lock_minutes_electronics: number;
  lock_minutes_normal: number;
  allow_checkout_on_verify_fail: boolean;
  max_supplier_delta_pct: number;
}

export const DEFAULT_PRICE_VALIDATION_SETTINGS: PriceValidationSettings = {
  electronics_refresh_minutes: 45,
  cart_item_refresh_minutes: 20,
  hot_item_refresh_minutes: 30,
  normal_refresh_minutes: 240,
  cold_refresh_minutes: 1080,
  lock_minutes_electronics: 30,
  lock_minutes_normal: 60,
  allow_checkout_on_verify_fail: false,
  max_supplier_delta_pct: 25,
};

const ELECTRONICS_KEYWORDS = [
  "phone", "iphone", "samsung galaxy", "pixel", "oneplus",
  "laptop", "macbook", "thinkpad", "chromebook",
  "tablet", "ipad",
  "camera", "gopro", "dslr",
  "ps5", "ps4", "xbox", "switch", "console",
  "tv", "television", "monitor",
];

export function classifyTier(opts: {
  category?: string | null;
  title?: string | null;
  isVehicle?: boolean;
  isHot?: boolean;
  inCart?: boolean;
  recentClicks?: number;
  recentCarts?: number;
  daysSinceLastView?: number | null;
}): RefreshTier {
  if (opts.isVehicle) return "vehicle";
  if (opts.inCart) return "cart";
  if (opts.isHot) return "hot";

  const cat = (opts.category || "").toLowerCase();
  const title = (opts.title || "").toLowerCase();
  if (cat.includes("electronic") || cat.includes("phone") || cat.includes("laptop") ||
      ELECTRONICS_KEYWORDS.some((k) => title.includes(k))) {
    return "electronics";
  }

  if ((opts.recentClicks ?? 0) > 0 || (opts.recentCarts ?? 0) > 0) return "normal";
  if (opts.daysSinceLastView != null && opts.daysSinceLastView > 7) return "cold";
  return "normal";
}

export function ttlMinutesForTier(tier: RefreshTier, s: PriceValidationSettings): number | null {
  switch (tier) {
    case "cart": return s.cart_item_refresh_minutes;
    case "hot": return s.hot_item_refresh_minutes;
    case "electronics": return s.electronics_refresh_minutes;
    case "normal": return s.normal_refresh_minutes;
    case "cold": return s.cold_refresh_minutes;
    case "vehicle": return null; // never auto-refresh
  }
}

export function lockMinutesForTier(tier: RefreshTier, s: PriceValidationSettings): number {
  if (tier === "electronics" || tier === "cart" || tier === "hot") {
    return s.lock_minutes_electronics;
  }
  return s.lock_minutes_normal;
}

export function isElectronicsTitle(title: string | null | undefined): boolean {
  if (!title) return false;
  const t = title.toLowerCase();
  return ELECTRONICS_KEYWORDS.some((k) => t.includes(k));
}

export async function loadPriceValidationSettings(
  supabaseUrl: string,
  serviceKey: string,
): Promise<PriceValidationSettings> {
  try {
    const res = await fetch(
      `${supabaseUrl}/rest/v1/price_validation_settings?select=*&limit=1`,
      {
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
          Accept: "application/vnd.pgrst.object+json",
        },
      },
    );
    if (!res.ok) return DEFAULT_PRICE_VALIDATION_SETTINGS;
    const row = await res.json();
    return { ...DEFAULT_PRICE_VALIDATION_SETTINGS, ...row };
  } catch {
    return DEFAULT_PRICE_VALIDATION_SETTINGS;
  }
}

export function inferMarketplace(url: string | null | undefined): string {
  if (!url) return "unknown";
  const u = url.toLowerCase();
  if (u.includes("amazon.")) return "amazon";
  if (u.includes("ebay.")) return "ebay";
  if (u.includes("shein.")) return "shein";
  if (u.includes("walmart.")) return "walmart";
  if (u.includes("aliexpress.")) return "aliexpress";
  if (u.includes("carvana.") || u.includes("cargurus.")) return "vehicle";
  return "other";
}
