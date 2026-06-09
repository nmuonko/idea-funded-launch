/**
 * Price floors for high-value products.
 *
 * Purpose: many eBay listings show the auction *starting bid* (e.g. $1) or are
 * parts-only / "for repair" listings. When ingested at face value they make us
 * display dramatically wrong prices (e.g. iPhone 17 Pro Max 1TB @ $399 when the
 * real price is ~$2,300+). That is a money-losing bug.
 *
 * This module returns a *minimum reasonable USD price* for a given product
 * title. If the listing's price is below the floor by a wide margin we treat
 * the listing as untrustworthy and drop it (or flag it for review).
 *
 * Floors are intentionally conservative — set to roughly 70% of the cheapest
 * legitimate "Good/Refurbished Unlocked" street price so genuine deals still
 * pass, but obvious junk gets dropped.
 */

export interface PriceFloorMatch {
  /** Minimum reasonable price in USD for this model. */
  floorUsd: number;
  /** Name of the matched model rule (for logging). */
  modelKey: string;
}

interface ModelRule {
  key: string;
  /** Regex applied to lowercased title. ALL patterns must match. */
  patterns: RegExp[];
  /** Storage-tier floors. Use 'default' when no storage tier matches. */
  floors: { storage: RegExp | "default"; floorUsd: number }[];
}

/**
 * Storage tier helpers. We look at the title for explicit "1 TB", "512 GB",
 * "256 GB", "128 GB" tokens. eBay titles use mixed spacing/casing.
 */
const STORAGE_1TB = /\b1\s*tb\b/i;
const STORAGE_512 = /\b512\s*gb\b/i;
const STORAGE_256 = /\b256\s*gb\b/i;
const STORAGE_128 = /\b128\s*gb\b/i;

const MODEL_RULES: ModelRule[] = [
  // ──────────────────────── iPhone 17 series ────────────────────────
  {
    key: "iphone_17_pro_max",
    patterns: [/iphone\s*17\s*pro\s*max/i],
    floors: [
      { storage: STORAGE_1TB, floorUsd: 1500 },
      { storage: STORAGE_512, floorUsd: 1300 },
      { storage: STORAGE_256, floorUsd: 1100 },
      { storage: "default",   floorUsd: 1000 },
    ],
  },
  {
    key: "iphone_17_pro",
    patterns: [/iphone\s*17\s*pro\b/i, /(?!.*max)/i],
    floors: [
      { storage: STORAGE_1TB, floorUsd: 1300 },
      { storage: STORAGE_512, floorUsd: 1100 },
      { storage: STORAGE_256, floorUsd: 900  },
      { storage: "default",   floorUsd: 800  },
    ],
  },
  {
    key: "iphone_17",
    patterns: [/iphone\s*17\b/i, /(?!.*pro)/i],
    floors: [
      { storage: STORAGE_512, floorUsd: 850 },
      { storage: STORAGE_256, floorUsd: 700 },
      { storage: "default",   floorUsd: 600 },
    ],
  },
  // ──────────────────────── iPhone 16 series ────────────────────────
  {
    key: "iphone_16_pro_max",
    patterns: [/iphone\s*16\s*pro\s*max/i],
    floors: [
      { storage: STORAGE_1TB, floorUsd: 1200 },
      { storage: STORAGE_512, floorUsd: 1000 },
      { storage: STORAGE_256, floorUsd: 850  },
      { storage: "default",   floorUsd: 750  },
    ],
  },
  {
    key: "iphone_16_pro",
    patterns: [/iphone\s*16\s*pro\b/i, /(?!.*max)/i],
    floors: [
      { storage: STORAGE_1TB, floorUsd: 1000 },
      { storage: STORAGE_512, floorUsd: 850 },
      { storage: STORAGE_256, floorUsd: 700 },
      { storage: "default",   floorUsd: 600 },
    ],
  },
  {
    key: "iphone_16",
    patterns: [/iphone\s*16\b/i, /(?!.*pro)/i],
    floors: [
      { storage: STORAGE_256, floorUsd: 550 },
      { storage: "default",   floorUsd: 450 },
    ],
  },
  // ──────────────────────── iPhone 15 series ────────────────────────
  {
    key: "iphone_15_pro_max",
    patterns: [/iphone\s*15\s*pro\s*max/i],
    floors: [
      { storage: STORAGE_1TB, floorUsd: 1000 },
      { storage: STORAGE_512, floorUsd: 850  },
      { storage: STORAGE_256, floorUsd: 700  },
      { storage: "default",   floorUsd: 600  },
    ],
  },
  {
    key: "iphone_15_pro",
    patterns: [/iphone\s*15\s*pro\b/i, /(?!.*max)/i],
    floors: [
      { storage: STORAGE_512, floorUsd: 700 },
      { storage: STORAGE_256, floorUsd: 550 },
      { storage: "default",   floorUsd: 500 },
    ],
  },
  {
    key: "iphone_15",
    patterns: [/iphone\s*15\b/i, /(?!.*pro)/i],
    floors: [{ storage: "default", floorUsd: 400 }],
  },
  // ──────────────────────── iPhone 14 series ────────────────────────
  {
    key: "iphone_14_pro_max",
    patterns: [/iphone\s*14\s*pro\s*max/i],
    floors: [{ storage: "default", floorUsd: 500 }],
  },
  {
    key: "iphone_14_pro",
    patterns: [/iphone\s*14\s*pro\b/i, /(?!.*max)/i],
    floors: [{ storage: "default", floorUsd: 400 }],
  },
  // ──────────────────────── Samsung S25 / S24 Ultra ────────────────
  {
    key: "galaxy_s25_ultra",
    patterns: [/galaxy\s*s25\s*ultra/i],
    floors: [
      { storage: STORAGE_1TB, floorUsd: 1200 },
      { storage: STORAGE_512, floorUsd: 1000 },
      { storage: STORAGE_256, floorUsd: 850  },
      { storage: "default",   floorUsd: 800  },
    ],
  },
  {
    key: "galaxy_s24_ultra",
    patterns: [/galaxy\s*s24\s*ultra/i],
    floors: [
      { storage: STORAGE_1TB, floorUsd: 1000 },
      { storage: STORAGE_512, floorUsd: 850  },
      { storage: STORAGE_256, floorUsd: 700  },
      { storage: "default",   floorUsd: 650  },
    ],
  },
  // ──────────────────────── Google Pixel 9 Pro ─────────────────────
  {
    key: "pixel_9_pro_xl",
    patterns: [/pixel\s*9\s*pro\s*xl/i],
    floors: [
      { storage: STORAGE_512, floorUsd: 800 },
      { storage: STORAGE_256, floorUsd: 650 },
      { storage: "default",   floorUsd: 600 },
    ],
  },
];

/**
 * Resolve the price floor for a product title. Returns null when the title
 * doesn't match any known high-value model (we don't enforce a floor then).
 */
export function getPriceFloor(title: string | null | undefined): PriceFloorMatch | null {
  if (!title) return null;
  const t = title.toLowerCase();
  for (const rule of MODEL_RULES) {
    const allMatch = rule.patterns.every(p => p.test(t));
    if (!allMatch) continue;
    for (const f of rule.floors) {
      if (f.storage === "default") {
        return { floorUsd: f.floorUsd, modelKey: rule.key };
      }
      if (f.storage.test(t)) {
        return { floorUsd: f.floorUsd, modelKey: `${rule.key}_${f.storage.source}` };
      }
    }
  }
  return null;
}

/**
 * Returns true if the priceUsd is implausibly low for the given title and
 * should be dropped from listings. Used by ingestion to reject auction-start
 * prices, parts-only listings, etc.
 */
export function isImplausiblyLow(title: string | null | undefined, priceUsd: number | null | undefined): boolean {
  if (priceUsd == null || priceUsd <= 0) return false;
  const floor = getPriceFloor(title);
  if (!floor) return false;
  return priceUsd < floor.floorUsd;
}
