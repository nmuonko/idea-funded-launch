/**
 * Search Intent Scorer
 * Scores and ranks items based on classified search intent.
 * Drops $0 items unconditionally.
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

  // ── BASE SCORE: query-token match ───────────────────────────────────
  let score = 0;
  for (const tok of qTokens) {
    if (tok.length >= 2 && title.includes(tok)) score += 2;
  }

  // ── INTENT-SPECIFIC SCORING ─────────────────────────────────────────
  switch (intent.intentKey) {
    case "vehicle_listing": {
      if (hasAny(title, VEHICLE_PARTS_KW)) return null;  // Drop parts
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
      if (hasAny(title, PHONE_ACCESSORY_KW)) score -= 80;
      if (hasAny(title, PHONE_DEVICE_SIGNALS)) score += 12;
      break;
    }
    case "phone_accessory": {
      if (hasAny(title, PHONE_ACCESSORY_KW)) score += 10;
      if (hasAny(title, PHONE_DEVICE_SIGNALS)) score -= 20; // Actual phone, not accessory
      break;
    }
    case "heavy_equipment": {
      // Keep everything, light boost for relevant terms
      if (hasAny(title, ["tractor","excavator","loader","bulldozer","backhoe","john deere","kubota","caterpillar","massey","case ih"])) score += 10;
      break;
    }
    case "general":
    default: {
      // Light penalty for accessories when query looks like a device model
      if (intent.phoneDeviceIntent && hasAny(title, PHONE_ACCESSORY_KW)) score -= 30;
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
