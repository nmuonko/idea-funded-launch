/**
 * Category Price Caps
 *
 * Business-rule price ceilings applied to specific product categories regardless
 * of user filters. Stakeholders requested that laptops above $400 be removed
 * from both web and mobile catalog responses, so this lives in shared code and
 * is applied wherever search/catalog results are finalized.
 *
 * Detection is title-based and intentionally conservative — accessories such as
 * laptop chargers, cases, stands, batteries, sleeves, etc. are NOT treated as
 * laptops and therefore are not capped.
 */

export interface PriceCapItem {
  title?: string | null;
  priceUsd?: number | null;
  price_usd?: number | null;
  category?: string | null;
}

const LAPTOP_PRICE_CAP_USD = 400;

// Words that indicate the product is an actual laptop / notebook computer.
const LAPTOP_DEVICE_REGEX =
  /\b(laptop|laptops|macbook|mac\s?book|notebook computer|chromebook|ultrabook|gaming laptop|thinkpad|dell xps|surface laptop|hp pavilion laptop|asus rog laptop)\b/i;

// Words that indicate the listing is a laptop accessory, not a laptop itself.
const LAPTOP_ACCESSORY_REGEX =
  /\b(charger|adapter|power supply|case|sleeve|bag|backpack|stand|riser|cooler|cooling pad|battery|screen protector|skin|decal|sticker|keyboard|mouse|dock|hub|cable|cord|cleaner|wipes?|lock|mount|tray|table|desk|fan|hinge|shell|cover|replacement (lcd|screen|display|hinge|keyboard)|lcd screen|replacement parts?|spare parts?)\b/i;

function isActualLaptop(title: string, category: string): boolean {
  if (!LAPTOP_DEVICE_REGEX.test(title)) return false;
  if (LAPTOP_ACCESSORY_REGEX.test(title)) return false;
  // Category sanity: if backend categorized this as accessories, do not treat as laptop.
  if (/accessor(y|ies)|charger|case|battery|cable/.test(category)) return false;
  return true;
}

/**
 * Apply hard category-based price caps to a list of items.
 * Currently: drops actual laptops priced strictly above LAPTOP_PRICE_CAP_USD.
 */
export function applyCategoryPriceCaps<T extends PriceCapItem>(items: T[]): T[] {
  if (!Array.isArray(items) || items.length === 0) return items;
  return items.filter((item) => {
    const title = (item.title || "").toLowerCase();
    const category = (item.category || "").toLowerCase();
    const price = Number(item.priceUsd ?? item.price_usd ?? 0) || 0;
    if (isActualLaptop(title, category) && price > LAPTOP_PRICE_CAP_USD) {
      return false;
    }
    return true;
  });
}

export const LAPTOP_PRICE_CAP = LAPTOP_PRICE_CAP_USD;
