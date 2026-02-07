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
      if (priceUsd >= 1000) score += 5;
      if (priceUsd < 300) score -= 30;  // Likely accessory priced
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

      // HARD DROP: accessories without device signal — always drop
      if (isAccessory && !hasDeviceSignal) return null;

      // HARD DROP: known accessory-only patterns ("for iphone", "compatible with", etc.)
      const PHONE_FOR_PATTERNS = [
        "for iphone","for samsung","for galaxy","for pixel","for xiaomi",
        "for tecno","for infinix","for redmi","for oneplus","for motorola",
        "compatible with","fits","designed for","made for",
      ];
      if (hasAny(title, PHONE_FOR_PATTERNS) && !hasDeviceSignal) return null;

      // HARD DROP: charger/cable/case-dominated titles without any phone model signal
      const STRONG_ACCESSORY = [
        "charger","cable","adapter","wall charger","car charger","fast charger",
        "charging block","power block","usb c","lightning","magsafe",
        "screen protector","tempered glass","case for","clear case","phone case",
      ];
      if (hasAny(title, STRONG_ACCESSORY) && !hasDeviceSignal) return null;

      // Boost items with device signals
      if (hasDeviceSignal) score += 15;

      // Penalize accessories that have device signal (e.g., "Samsung Galaxy S24 case" with "Galaxy" signal)
      if (isAccessory && hasDeviceSignal) score -= 20;

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
      // ── STEP 0: Drop furniture/storage/non-console items ──
      const GAMING_NOT_CONSOLE = [
        "storage","stand","shelf","rack","organizer","furniture","desk","table",
        "chair","cabinet","tower","wall mount","tv mount","display case",
        "special edition","metal case","steelbook","game case",
      ];
      if (hasAny(title, GAMING_NOT_CONSOLE)) return null;
      // ── STEP 1: Hard-drop accessories (EN + FR) ──
      const GAMING_ACCESSORY_DROP = [
        "headset","headphones","earphones","mic","microphone",
        "controller","manette","joystick","gamepad",
        "dock","charging","charger","chargeur",
        "cable","câble","usb","hdmi","adapter","adaptateur",
        "skin","sticker","decal","grip","cover","coque",
        "protection","cooling fan","ventilateur",
        "repair","replacement","spare","parts","pièce",
        "sac","bag","backpack",
        "poster","shirt","shoes","figurine","mod","script",
        "sauce","mcdonalds","mug","cup","keychain","wallet","socks",
        "hat","cap","band","strap","mount","holder",
        "accessory","accessoires",
      ];
      if (hasAny(title, GAMING_ACCESSORY_DROP)) return null;

      // ── STEP 2: Drop "for X" / "compatible with" patterns ──
      const FOR_PATTERNS = [
        "for ps5","for ps4","for ps3","for xbox","for nintendo",
        "for switch","for playstation","compatible with","fits","works with",
        "designed for","made for",
      ];
      if (hasAny(title, FOR_PATTERNS)) return null;

      // ── STEP 3: Drop lots / bundles / multi-item listings ──
      const LOT_BUNDLE_DROP = [
        "lot","bundle","job lot","bulk","mixed","assorted","collection",
        "set of","pack","power tested mixed","w/ games lot","games lot",
        "w/ cables","with cables","avec cables","avec câbles",
        "w/ games","with games","avec jeux","w games","consoles & games","mega",
      ];
      if (hasAny(title, LOT_BUNDLE_DROP)) return null;
      // Regex: "lot of <number>" or "<number>x" near console terms
      if (/lot\s+of\s+\d+/i.test(title)) return null;
      if (/\b\d+\s*x\b/i.test(title)) return null;

      // ── STEP 4: Drop broken / for-parts / as-is ──
      const BROKEN_DROP = [
        "for parts","parts only","not working","broken","as-is","as is",
        "untested","read description","faulty","doesn't work","no power",
        "defective","damaged","cracked","dead","won't turn on",
      ];
      if (hasAny(title, BROKEN_DROP)) return null;

      // ── STEP 5: Drop used condition (via metadata or top-level condition field) ──
      const conditionName = ((item.condition ?? item.conditionName ?? (item.metadata as any)?.condition) || "").toString().toLowerCase();
      if (conditionName.includes("for parts") || conditionName.includes("not working")) return null;
      // Allow: new, manufacturer refurbished, seller refurbished, certified refurbished, open box
      // Drop: used, acceptable, good (we only want new/refurb)
      if (conditionName === "used" || conditionName === "good" || conditionName === "acceptable") return null;
      if (conditionName === "open box") return null; // Open box is not new/refurb

      // ── STEP 6: Must match a specific console model ──
      const CONSOLE_MODEL_SIGNALS = [
        "playstation 5 slim","playstation 5","ps5 slim","ps5 console","ps5 digital",
        "playstation 4","ps4 console","ps4 slim","ps4 pro",
        "xbox series s","xbox series x",
        "xbox one x","xbox one s","xbox one console","xbox one",
        "xbox 360","xbox 360 console",
        "nintendo switch 2","nintendo switch console","nintendo switch",
        "wii u console","wii console",
        "steam deck","rog ally",
      ];
      const hasBrandAndConsole = title.includes("console") && 
        hasAny(title, ["playstation","xbox","nintendo","sony","microsoft"]);
      
      if (!hasAny(title, CONSOLE_MODEL_SIGNALS) && !hasBrandAndConsole) return null;

      // Price sanity
      if (priceUsd > 3000) return null;
      if (priceUsd < 30) return null; // Too cheap to be a real console

      // ── STEP 7: Ranking — prefer New > Refurbished ──
      if (conditionName.includes("new") || conditionName === "" || title.includes("brand new") || title.includes("sealed")) score += 20;
      else if (conditionName.includes("refurbished") || title.includes("refurbished") || title.includes("renewed") || title.includes("certified")) score += 10;

      // Boost exact console model matches
      if (hasAny(title, CONSOLE_MODEL_SIGNALS)) score += 15;
      if (hasBrandAndConsole) score += 10;
      
      // Boost single-console listings (title has "console" + exactly one model)
      if (title.includes("console")) score += 5;
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
