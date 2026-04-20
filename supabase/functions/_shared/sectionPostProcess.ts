/**
 * sectionPostProcess.ts — Deduplication, smart ranking, old-product penalty,
 * and diversity enforcement for mobile homepage sections.
 *
 * Applied AFTER items are collected and filtered but BEFORE caching.
 */

import type { SectionItem } from "./sectionProfiles.ts";

// ─── OLD / OUTDATED PRODUCT PATTERNS ─────────────────────────────────────────
// Phones / tablets older than ~3-4 generations → heavily penalise or remove
const OLD_PHONE_PATTERNS: RegExp[] = [
  // Apple — anything before iPhone 12 is 4+ generations old
  /\biphone\s*(4|4s|5|5s|5c|6|6s|6\+|7|7\+|8|8\+|se\b(?!\s*[3-9]))/i,
  /\biphone\s*(x|xr|xs|10|11)\b/i,
  // Samsung — anything before S21 / A5x
  /\bgalaxy\s*s[1-9]\b/i,        // S1-S9
  /\bgalaxy\s*s1[0-9]\b/i,       // S10-S19
  /\bgalaxy\s*s20\b/i,
  /\bgalaxy\s*note\s*[1-9]\b/i,  // Note 1-9
  /\bgalaxy\s*note\s*10\b/i,
  /\bgalaxy\s*note\s*20\b/i,
  /\bgalaxy\s*a[0-4][0-9]\b/i,   // A10-A49
  // Google Pixel — before Pixel 7
  /\bpixel\s*[1-6]\b/i,
  // OnePlus old
  /\boneplus\s*[1-8]\b/i,
  // Generic old keywords
  /\b(refurbished|renewed)\b.*\b(iphone\s*(6|7|8|x|11)|galaxy\s*s[1-9]|pixel\s*[1-5])\b/i,
];

// Modern / high-demand products → boost
const MODERN_BOOST_PATTERNS: RegExp[] = [
  /\biphone\s*(1[5-9]|2[0-9])\b/i,          // iPhone 15+
  /\bgalaxy\s*s2[4-9]\b/i,                    // Galaxy S24+
  /\bgalaxy\s*z\s*(flip|fold)\s*[5-9]\b/i,    // Z Flip/Fold 5+
  /\bpixel\s*[8-9]\b/i,                       // Pixel 8+
  /\bmacbook\s*(air|pro)\s*(m[2-9]|202[4-9])/i, // MacBook M2+
  /\bipad\s*(pro|air)\s*(202[4-9]|m[2-9])/i,  // iPad Pro/Air 2024+
  /\bps5\b/i, /\bxbox\s*series\s*[xs]\b/i,    // Current-gen consoles
  /\bnintendo\s*switch\s*(oled|2)\b/i,
  /\btesla\s*model\s*[3ys]\b/i,
];

// ─── TITLE NORMALIZATION FOR DEDUP ───────────────────────────────────────────

function normalizeForDedup(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")       // strip non-alphanum
    .replace(/\b(new|used|refurbished|renewed|certified|open\s*box|like\s*new|pre\s*owned)\b/g, "")
    .replace(/\b(free\s*shipping|fast\s*ship|ships?\s*free|brand\s*new|sealed)\b/g, "")
    .replace(/\b(unlocked|gsm|cdma|at\s*t|t\s*mobile|verizon|sprint)\b/g, "")
    .replace(/\b\d+\s*(gb|tb|ram|ssd|hdd|mah)\b/g, "")  // remove storage/spec variants
    .replace(/\s+/g, " ")
    .trim();
}

/** Extract brand+model key for grouping (e.g. "apple iphone 16 pro") */
function extractBrandModel(title: string): string {
  const t = title.toLowerCase();
  
  // iPhone patterns
  const iphoneMatch = t.match(/iphone\s*(\d+\s*(pro\s*max|pro|plus|mini)?)/i);
  if (iphoneMatch) return `apple iphone ${iphoneMatch[1].trim()}`;
  
  // Samsung Galaxy
  const galaxyMatch = t.match(/galaxy\s*(s\d+|a\d+|z\s*(flip|fold)\s*\d*|note\s*\d+)/i);
  if (galaxyMatch) return `samsung galaxy ${galaxyMatch[1].trim()}`;
  
  // Pixel
  const pixelMatch = t.match(/pixel\s*(\d+\s*(pro|a)?)/i);
  if (pixelMatch) return `google pixel ${pixelMatch[1].trim()}`;
  
  // MacBook
  const macMatch = t.match(/macbook\s*(air|pro)\s*(m\d+|\d{4})?/i);
  if (macMatch) return `apple macbook ${macMatch[1]} ${(macMatch[2] || "").trim()}`.trim();

  // Generic: use first 5 significant words
  return normalizeForDedup(title).split(/\s+/).slice(0, 5).join(" ");
}

// ─── DEDUPLICATION ───────────────────────────────────────────────────────────

/**
 * Deduplicate items by normalized title similarity.
 * Keeps the cheapest listing per brand+model group.
 */
export function deduplicateItems(items: SectionItem[]): SectionItem[] {
  const seen = new Map<string, SectionItem>();
  
  for (const item of items) {
    const key = extractBrandModel(item.title);
    const existing = seen.get(key);
    if (!existing) {
      seen.set(key, item);
    } else {
      // Keep cheapest
      const existingPrice = existing.price_usd ?? existing.priceUsd ?? Infinity;
      const newPrice = item.price_usd ?? item.priceUsd ?? Infinity;
      if (newPrice < existingPrice) {
        seen.set(key, item);
      }
    }
  }
  
  // Also deduplicate by exact normalized title (catches remaining dupes)
  const titleSeen = new Map<string, SectionItem>();
  for (const item of seen.values()) {
    const normTitle = normalizeForDedup(item.title);
    const existing = titleSeen.get(normTitle);
    if (!existing) {
      titleSeen.set(normTitle, item);
    } else {
      const ep = existing.price_usd ?? existing.priceUsd ?? Infinity;
      const np = item.price_usd ?? item.priceUsd ?? Infinity;
      if (np < ep) titleSeen.set(normTitle, item);
    }
  }
  
  return Array.from(titleSeen.values());
}

// ─── SMART RANKING ──────────────────────────────────────────────────────────

/**
 * Score and rank items, BIASED TOWARD CHEAPEST RELEVANT FIRST.
 *   score = 0.35 * relevance + 0.55 * price_score + 0.10 * freshness
 *
 * Phones section additionally rewards refurbished/renewed listings.
 */
export function smartRankItems(items: SectionItem[], sectionKey: string): SectionItem[] {
  if (items.length === 0) return items;

  const prices = items
    .map(i => i.price_usd ?? i.priceUsd ?? 0)
    .filter(p => p > 0);
  const avgPrice = prices.length > 0 ? prices.reduce((a, b) => a + b, 0) / prices.length : 100;
  const maxPrice = Math.max(...prices, 1);

  const refurbRegex = /\b(renewed|refurbished|reconditioned|certified pre[- ]?owned|open box|pre[- ]?owned)\b/i;
  const isPhonesSection = sectionKey === "phones";
  const isElectronicsSection = sectionKey === "electronics";

  const scored = items.map(item => {
    const title = item.title || "";
    const price = item.price_usd ?? item.priceUsd ?? avgPrice;

    let relevance = 0.5;
    if (MODERN_BOOST_PATTERNS.some(p => p.test(title))) relevance = 1.0;
    if (OLD_PHONE_PATTERNS.some(p => p.test(title))) relevance = 0.0;

    const priceScore = price > 0 ? Math.max(0, 1 - (price / maxPrice)) : 0.5;

    let freshness = 0.5;
    if (MODERN_BOOST_PATTERNS.some(p => p.test(title))) freshness = 1.0;
    if (OLD_PHONE_PATTERNS.some(p => p.test(title))) freshness = 0.0;

    // Cheaper-first weighting (price dominates)
    let score = (0.35 * relevance) + (0.55 * priceScore) + (0.10 * freshness);

    // Phones: strongly reward refurbished / renewed listings
    if (isPhonesSection && refurbRegex.test(title)) score += 0.30;
    // Electronics: extra bonus for very cheap items
    if (isElectronicsSection && price > 0 && price < avgPrice * 0.6) score += 0.10;

    return { item, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.map(s => s.item);
}

// ─── REMOVE OLD / LOW-VALUE PRODUCTS ────────────────────────────────────────

/**
 * Remove or heavily downrank outdated products.
 * For phones/electronics/refurbished sections, remove items matching OLD patterns.
 * For other sections, just deprioritize them.
 */
export function removeOldProducts(items: SectionItem[], sectionKey: string): SectionItem[] {
  const strictSections = ["phones", "electronics", "refurbished"];
  const isStrict = strictSections.includes(sectionKey);
  
  if (!isStrict) return items; // Only filter phone-related sections
  
  return items.filter(item => {
    const title = item.title || "";
    const isOld = OLD_PHONE_PATTERNS.some(p => p.test(title));
    if (isOld && isStrict) return false; // Remove from strict sections
    return true;
  });
}

// ─── DIVERSITY CONTROL ──────────────────────────────────────────────────────

/**
 * Ensure no more than MAX_SAME_MODEL consecutive items of the same brand+model.
 * Reorders items to interleave variety.
 */
export function enforceDiversity(items: SectionItem[], maxSameModel: number = 2): SectionItem[] {
  if (items.length <= maxSameModel) return items;
  
  // Group by brand+model
  const groups = new Map<string, SectionItem[]>();
  for (const item of items) {
    const key = extractBrandModel(item.title);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(item);
  }
  
  // Round-robin interleave groups, respecting original order within each group
  const result: SectionItem[] = [];
  const queues = Array.from(groups.values());
  // Sort queues by first item's score (cheapest first within each group already)
  
  let exhausted = false;
  while (!exhausted) {
    exhausted = true;
    for (const queue of queues) {
      // Take up to maxSameModel from each group per round
      for (let i = 0; i < maxSameModel && queue.length > 0; i++) {
        result.push(queue.shift()!);
        exhausted = false;
      }
    }
  }
  
  return result;
}

// ─── REFURBISHED SECTION FILTER ─────────────────────────────────────────────

/** High-demand brands/products that are desirable in refurbished */
const REFURB_DESIRABLE = [
  /\biphone\s*(1[2-9]|2[0-9])/i,
  /\bmacbook\b/i,
  /\bipad\s*(pro|air|mini)/i,
  /\bgalaxy\s*s2[1-9]/i,
  /\bgalaxy\s*z/i,
  /\bpixel\s*[7-9]/i,
  /\bairpods\s*(pro|max)/i,
  /\bapple\s*watch\b/i,
  /\bdyson\b/i,
  /\bplaystation\s*5\b|\bps5\b/i,
  /\bxbox\s*series\b/i,
  /\bnintendo\s*switch\b/i,
  /\bsamsung\s*(tv|monitor|galaxy\s*tab)/i,
  /\bsony\s*(wh|wf|alpha)/i,
  /\bbose\b/i,
  /\bthinkpad\b/i,
  /\bdell\s*xps\b/i,
  /\bsurface\s*(pro|laptop)/i,
];

/**
 * For the refurbished section, keep only high-demand recognizable products.
 */
export function filterRefurbishedQuality(items: SectionItem[]): SectionItem[] {
  const desirable = items.filter(item => {
    const title = item.title || "";
    // Must match at least one desirable pattern
    return REFURB_DESIRABLE.some(p => p.test(title));
  });
  
  // If we filtered too aggressively, fall back to keeping all
  if (desirable.length < 5 && items.length >= 5) return items;
  return desirable;
}

// ─── MASTER POST-PROCESSOR ─────────────────────────────────────────────────

/**
 * Apply all post-processing steps to a section's items.
 * Call this for each section after collection/backfill, before caching.
 */
/** Maximum allowed display price (USD) for any homepage section item. */
export const HOMEPAGE_MAX_PRICE_USD = 200;

/** Sections exempt from the homepage price ceiling. */
const PRICE_CEILING_EXEMPT_SECTIONS = new Set(["vehicles", "cars"]);

/**
 * Remove items above the homepage price ceiling.
 * Items missing/zero price are DROPPED (we cannot verify they fit the cap).
 * Vehicles/cars section is exempt — cars naturally cost more than $200.
 */
export function enforceMaxPrice(
  items: SectionItem[],
  sectionKey: string,
  maxPrice: number = HOMEPAGE_MAX_PRICE_USD,
): SectionItem[] {
  if (PRICE_CEILING_EXEMPT_SECTIONS.has(sectionKey)) return items;
  return items.filter(item => {
    const price = item.price_usd ?? item.priceUsd;
    if (price == null || price <= 0) return false;
    return price <= maxPrice;
  });
}

export function postProcessSection(items: SectionItem[], sectionKey: string): SectionItem[] {
  // 1. Remove old/outdated products
  let processed = removeOldProducts(items, sectionKey);

  // 2. Enforce homepage price ceiling ($200 max, except vehicles/cars)
  processed = enforceMaxPrice(processed, sectionKey);

  // 3. Deduplicate
  processed = deduplicateItems(processed);
  
  // 3. Refurbished quality filter
  if (sectionKey === "refurbished") {
    processed = filterRefurbishedQuality(processed);
  }
  
  // 4. Smart rank (relevance + price + freshness)
  processed = smartRankItems(processed, sectionKey);
  
  // 5. Enforce diversity (max 2 same model in a row)
  processed = enforceDiversity(processed, 2);
  
  return processed;
}
