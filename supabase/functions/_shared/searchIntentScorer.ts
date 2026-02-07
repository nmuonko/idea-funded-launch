/**
 * Search Intent Scorer
 * Scores and ranks items based on classified search intent.
 * Drops $0 items unconditionally.
 * Hard-drops accessories for phone_device intent.
 * Hard-drops wrong-category items (shoes in phone search, etc.).
 */

import type { SearchIntent } from "./vehicleDetection.ts";
import {
  hasAny, hasYearToken, hasMileageToken,
  VEHICLE_PARTS_KW, PHONE_ACCESSORY_KW,
} from "./vehicleDetection.ts";

export interface ScoredItem {
  _score: number;
  [key: string]: unknown;
}

const VEHICLE_LISTING_SIGNALS = [
  "miles","mi","km","odometer","vin","clean title","salvage","rebuilt",
  "awd","4wd","4x4","fwd","rwd","suv","truck","sedan","coupe","hatchback",
  "convertible","automatic","manual","cvt","no reserve","runs","drives",
];

const PHONE_DEVICE_SIGNALS = [
  "unlocked","smartphone","5g","128gb","256gb","512gb","1tb",
  "factory unlocked","dual sim","renewed","refurbished","brand new","sealed",
  "cell phone","gsm","cdma","sim free",
];

// Hard accessory keywords for phone_device hard-drop
const HARD_ACCESSORY_KW = [
  "case","coque","cover","charger","cable","screen protector","protector",
  "tempered glass","magsafe","wireless charger","adapter","block","wall charger",
  "mount","holder","stand","dock","cradle","strap","band","folio","wallet case",
  "otterbox","spigen","armband","pop socket","ring","power bank","battery pack",
  "earbuds","headphones","airpods","lens","skin","decal",
];

// Wrong-category keywords — items containing these should be dropped for tech intents
const WRONG_CATEGORY_KW = [
  "shoes","sneakers","basketball shoes","running shoes","boots","sandals","slippers",
  "dress","pants","shorts","jeans","hoodie","jacket","shirt","t-shirt","polo",
  "jewelry","necklace","ring","bracelet","earring","pendant",
  "poster","wall art","canvas","framed","artwork","print",
  "blanket","towel","pillow","curtain","rug",
];

// Vehicle parts keywords for hard-drop in vehicle_listing
const VEHICLE_PARTS_HARD_DROP = [
  "tire","tires","pneus","rims","jante","battery","alternator","starter",
  "oil filter","air filter","brake pad","brake pads","rotors","headlight",
  "bumper","radiator","spark plug","muffler","exhaust","catalytic",
  "wiper","antenna","sensor","o2 sensor","strut","shock","gasket",
  "cv axle","control arm","ball joint","hub assembly","bearing",
  "oem","aftermarket","floor mat","floor mats","led bulb","light bar",
];

/**
 * Score a single item given intent + query tokens.
 * Returns null if the item should be DROPPED entirely.
 */
function scoreOne(
  item: Record<string, unknown>,
  intent: SearchIntent,
  qTokens: string[],
): number | null {
  const priceUsd = (item.priceUsd ?? item.price_usd ?? 0) as number;
  const title = ((item.title || "") as string).toLowerCase();

  // ── HARD DROPS ──────────────────────────────────────────────────────
  if (priceUsd <= 0) return null;               // Never return $0 items
  if (!title || title.length < 3) return null;   // Junk

  // ── WRONG-CATEGORY HARD DROP (for phone/accessory/gaming intents) ──
  if (
    (intent.intentKey === "phone_device" || intent.intentKey === "phone_accessory" || intent.intentKey === "gaming") &&
    hasAny(title, WRONG_CATEGORY_KW)
  ) {
    return null; // Drop shoes, clothing, jewelry etc. from phone/gaming searches
  }

  // ── BASE SCORE: query-token match ───────────────────────────────────
  let score = 0;
  for (const tok of qTokens) {
    if (tok.length >= 2 && title.includes(tok)) score += 2;
  }

  // ── INTENT-SPECIFIC SCORING ─────────────────────────────────────────
  switch (intent.intentKey) {
    case "vehicle_listing": {
      // Hard-drop parts
      if (hasAny(title, VEHICLE_PARTS_HARD_DROP)) return null;
      if (hasAny(title, VEHICLE_PARTS_KW)) return null;
      // Hard-drop wrong-category for vehicles too
      if (hasAny(title, WRONG_CATEGORY_KW)) return null;
      if (hasYearToken(title)) score += 20;
      if (hasMileageToken(title)) score += 15;
      if (hasAny(title, VEHICLE_LISTING_SIGNALS)) score += 8;
      if (priceUsd >= 1500) score += 5;
      if (priceUsd < 500) score -= 30;  // Likely accessory priced
      break;
    }
    case "vehicle_parts": {
      // Parts intent — boost parts, penalize listings
      if (hasAny(title, VEHICLE_PARTS_KW)) score += 10;
      if (hasYearToken(title) && priceUsd >= 5000) score -= 20; // Probably a full car
      break;
    }
    case "phone_device": {
      const isAccessory = hasAny(title, HARD_ACCESSORY_KW);
      const hasDeviceSignal = hasAny(title, PHONE_DEVICE_SIGNALS);

      // HARD DROP accessories that lack any device signal
      if (isAccessory && !hasDeviceSignal) return null;

      // Boost items with device signals
      if (hasDeviceSignal) score += 12;

      // Boost exact model match from query tokens (e.g. "iphone 13 pro max")
      const fullQuery = qTokens.join(" ");
      if (title.includes(fullQuery)) score += 25;

      break;
    }
    case "phone_accessory": {
      // Drop wrong-category already handled above
      if (hasAny(title, PHONE_ACCESSORY_KW)) score += 10;
      if (hasAny(title, PHONE_DEVICE_SIGNALS)) score -= 20; // Actual phone, not accessory
      break;
    }
    case "heavy_equipment": {
      if (hasAny(title, ["tractor","excavator","loader","bulldozer","backhoe","john deere","kubota","caterpillar","massey","case ih"])) score += 10;
      break;
    }
    case "gaming": {
      // Drop accessories, merch, and cheat devices
      if (hasAny(title, [
        "case","cover","skin","sticker","decal","poster","shirt","shoes",
        "bag","backpack","hat","cap","mug","cup","keychain","wallet","socks",
        "figurine","mod","script","adapter","converter","device scripts",
        "sauce","fort for sale","mcdonalds","premium fort",
      ])) return null;

      // Must contain at least one actual gaming signal to survive
      const GAMING_SIGNALS = [
        "console","xbox","playstation","ps5","ps4","ps3","nintendo","switch",
        "gamepad","controller","video game","xbox series","series x","series s",
        "wii","gamecube","sega","atari","game boy","3ds","steam deck","rog ally",
        "game disc","game lot","game collection","game bundle",
      ];
      if (!hasAny(title, GAMING_SIGNALS)) return null;

      // Price sanity: real consoles/games cost under $2000
      if (priceUsd > 2000) return null;

      // Boost known console terms
      if (hasAny(title, ["console","xbox","playstation","ps5","nintendo","switch","steam deck"])) score += 15;
      break;
    }
    case "general":
    default: {
      // Light penalty for accessories when query looks like a device model
      if (intent.phoneDeviceIntent && hasAny(title, PHONE_ACCESSORY_KW)) score -= 30;
      // Drop wrong-category for general with phone intent
      if (intent.phoneDeviceIntent && hasAny(title, WRONG_CATEGORY_KW)) return null;
      break;
    }
  }

  return score;
}

/**
 * Score, filter, and sort items by intent relevance.
 * - Drops $0 items
 * - Drops items with score === null (hard-filtered)
 * - Sorts by score descending
 * - Returns top `limit` items
 */
export function scoreAndRankItems<T extends Record<string, unknown>>(
  items: T[],
  intent: SearchIntent,
  queryTokens: string[],
  limit: number,
): { items: T[]; dropped: number; topScores: number[] } {
  const scored: Array<{ item: T; score: number }> = [];
  let dropped = 0;

  for (const item of items) {
    const s = scoreOne(item, intent, queryTokens);
    if (s === null) {
      dropped++;
      continue;
    }
    scored.push({ item, score: s });
  }

  // Sort descending
  scored.sort((a, b) => b.score - a.score);

  const topItems = scored.slice(0, limit).map(s => s.item);
  const topScores = scored.slice(0, 5).map(s => s.score);

  return { items: topItems, dropped, topScores };
}
