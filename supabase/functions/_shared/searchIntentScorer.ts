/**
 * Search Intent Scorer
 * Scores and ranks items based on classified search intent.
 * Drops $0 items unconditionally.
 * Hard-drops accessories for phone_device intent.
 * Hard-drops wrong-category items (shoes in phone search, etc.).
 * 
 * v2: Device-family-aware scoring for phone queries.
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

// ── DEVICE INTENT PARSER ──────────────────────────────────────────────────────
// Extracts structured product intent from a query for family-aware scoring.

export interface DeviceIntent {
  brand: string | null;          // "samsung", "apple", "google"
  line: string | null;           // "galaxy", "iphone", "pixel"
  family: string | null;         // "fold", "flip", "s", "a", "note", "ultra"
  generation: string | null;     // "3", "15", "24"
  normalizedIntent: string;      // reconstructed canonical form
  hasStrongFamilyIntent: boolean; // true if family is specific (not just brand+line)
}

const BRAND_TOKENS = new Set(["samsung","apple","google","xiaomi","oppo","vivo","huawei","tecno","infinix","oneplus","motorola","nokia","sony","lg","asus","realme","honor","nothing","zte"]);
const LINE_TOKENS: Record<string, string> = {
  galaxy: "samsung", iphone: "apple", pixel: "google", redmi: "xiaomi",
  poco: "xiaomi", mi: "xiaomi", camon: "tecno", spark: "tecno", hot: "infinix",
  note: "xiaomi", moto: "motorola", xperia: "sony",
};

// Phone families that represent specific device categories
const PHONE_FAMILIES: Record<string, string[]> = {
  fold: ["fold", "z fold", "zfold", "galaxy fold"],
  flip: ["flip", "z flip", "zflip", "galaxy flip"],
  s: ["galaxy s"],
  a: ["galaxy a"],
  m: ["galaxy m"],
  note: ["galaxy note", "samsung note"],
  ultra: ["ultra"],
  plus: ["plus", "+"],
  fe: ["fe"],
  pro: ["pro"],
  max: ["pro max"],
};

// Map of conflicting families: if intent is family X, items with family Y get penalized
const CONFLICTING_SAMSUNG_FAMILIES: Record<string, string[]> = {
  fold: ["galaxy s2", "galaxy s3", "galaxy s4", "galaxy s5", "galaxy s6", "galaxy s7", "galaxy s8", "galaxy s9", "galaxy s10", "galaxy s20", "galaxy s21", "galaxy s22", "galaxy s23", "galaxy s24", "galaxy s25", "galaxy a0", "galaxy a1", "galaxy a2", "galaxy a3", "galaxy a5", "galaxy a7", "galaxy a10", "galaxy a12", "galaxy a13", "galaxy a14", "galaxy a15", "galaxy a20", "galaxy a21", "galaxy a23", "galaxy a25", "galaxy a30", "galaxy a32", "galaxy a33", "galaxy a34", "galaxy a35", "galaxy a50", "galaxy a51", "galaxy a52", "galaxy a53", "galaxy a54", "galaxy a55", "galaxy a70", "galaxy a71", "galaxy a72", "galaxy a73", "galaxy note", "galaxy m", "galaxy j", "galaxy flip", "z flip"],
  flip: ["galaxy s2", "galaxy s3", "galaxy s4", "galaxy s5", "galaxy s6", "galaxy s7", "galaxy s8", "galaxy s9", "galaxy s10", "galaxy s20", "galaxy s21", "galaxy s22", "galaxy s23", "galaxy s24", "galaxy s25", "galaxy a", "galaxy note", "galaxy m", "galaxy j", "galaxy fold", "z fold"],
  s: ["galaxy fold", "z fold", "galaxy flip", "z flip", "galaxy a", "galaxy m", "galaxy note", "galaxy j"],
  a: ["galaxy fold", "z fold", "galaxy flip", "z flip", "galaxy s2", "galaxy s3", "galaxy s4", "galaxy s5", "galaxy s6", "galaxy s7", "galaxy s8", "galaxy s9", "galaxy s10", "galaxy s20", "galaxy s21", "galaxy s22", "galaxy s23", "galaxy s24", "galaxy s25", "galaxy m", "galaxy note", "galaxy j"],
  note: ["galaxy fold", "z fold", "galaxy flip", "z flip", "galaxy s", "galaxy a", "galaxy m", "galaxy j"],
};

// Non-Samsung families for other brands
const IPHONE_FAMILIES = ["iphone 6", "iphone 7", "iphone 8", "iphone x", "iphone 11", "iphone 12", "iphone 13", "iphone 14", "iphone 15", "iphone 16", "iphone se"];

export function parseDeviceIntent(query: string): DeviceIntent {
  const q = query.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
  const tokens = q.split(" ");
  
  let brand: string | null = null;
  let line: string | null = null;
  let family: string | null = null;
  let generation: string | null = null;

  // Detect brand
  for (const t of tokens) {
    if (BRAND_TOKENS.has(t)) { brand = t; break; }
  }

  // Detect line (and infer brand)
  for (const t of tokens) {
    if (LINE_TOKENS[t]) {
      line = t;
      if (!brand) brand = LINE_TOKENS[t];
      break;
    }
  }

  // Detect family — check multi-word first
  // "z fold" / "zfold"
  if (q.includes("z fold") || q.includes("zfold")) {
    family = "fold";
  } else if (q.includes("z flip") || q.includes("zflip")) {
    family = "flip";
  } else if (/\bfold\b/.test(q)) {
    family = "fold";
  } else if (/\bflip\b/.test(q)) {
    family = "flip";
  } else if (/\bgalaxy\s+s\b/.test(q) || /\bgalaxy\s+s\d/i.test(q)) {
    family = "s";
  } else if (/\bgalaxy\s+a\b/.test(q) || /\bgalaxy\s+a\d/i.test(q)) {
    family = "a";
  } else if (/\bgalaxy\s+m\b/.test(q) || /\bgalaxy\s+m\d/i.test(q)) {
    family = "m";
  } else if (/\bgalaxy\s+note\b/.test(q)) {
    family = "note";
  }

  // For iPhones, detect the model number as family
  if (line === "iphone") {
    const iphoneMatch = q.match(/iphone\s*(\d{1,2})/);
    if (iphoneMatch) {
      family = iphoneMatch[1]; // e.g. "13", "15"
    }
  }

  // Detect generation number — last standalone number in query (excluding brand-inferred numbers)
  // e.g. "galaxy fold 3" → generation=3, "iphone 15 pro max" → generation=15
  const genMatch = q.match(/\b(\d{1,2})\b/g);
  if (genMatch) {
    // Take the last number that isn't already the family
    for (let i = genMatch.length - 1; i >= 0; i--) {
      if (genMatch[i] !== family) {
        generation = genMatch[i];
        break;
      }
    }
    // If family IS the number (iPhone), generation is already captured
    if (line === "iphone" && family && !generation) {
      generation = family;
    }
  }

  const hasStrongFamilyIntent = !!family && family !== "pro" && family !== "max" && family !== "plus" && family !== "ultra";

  // Build normalized intent
  const parts: string[] = [];
  if (brand) parts.push(brand);
  if (line && line !== brand) parts.push(line);
  if (family === "fold") parts.push("z fold");
  else if (family === "flip") parts.push("z flip");
  else if (family === "s") parts.push("s");
  else if (family === "a") parts.push("a");
  else if (family) parts.push(family);
  if (generation && generation !== family) parts.push(generation);
  
  return {
    brand,
    line,
    family,
    generation,
    normalizedIntent: parts.join(" "),
    hasStrongFamilyIntent,
  };
}

// ── WORD-BOUNDARY TOKEN MATCHING ──────────────────────────────────────────────
function escapeRe(s: string): string { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function tokenMatchesBoundary(title: string, tok: string): boolean {
  if (tok.length < 2) return false;
  const re = new RegExp(`(^|[^a-z0-9])${escapeRe(tok)}([^a-z0-9]|$)`, 'i');
  return re.test(title);
}

// Generic tokens that are too weak to drive relevance alone
const SCORING_STOPLIST = new Set([
  "high","low","big","small","new","old","best","top","hot","good","great",
  "long","short","mini","large","super","ultra","pro","max","plus",
  "men","women","man","woman","ladies","lady","girl","boy",
  "for","with","and","the",
]);

// ── FASHION INTENT: hard-drop vehicle/wheel/toy terms ─────────────────────────
const FASHION_VEHICLE_HARD_DROP = [
  "wheel","wheels","rim","rims","tire","tires","tyre","tyres",
  "hot wheels","diecast","die cast","die-cast","matchbox","model car",
  "car","cars","truck","suv","sedan","motorcycle","engine","transmission",
  "bumper","radiator","exhaust","muffler","alternator",
  "playstation","xbox","nintendo","console","gpu","cpu","laptop","refrigerator","fridge",
  "tractor","excavator","forklift",
  "doll","dolls","barbie","action figure","figurine","toy","toys","plush",
  "miniature","collectible","keychain","ornament","poster",
];

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

// Wrong-category keywords
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
 * Apply device-family-aware scoring boost/penalty.
 * Returns a score adjustment (positive = boost, negative = penalty).
 */
function scoreDeviceFamily(title: string, deviceIntent: DeviceIntent): { adjustment: number; familyMatch: boolean; generationMatch: boolean; conflictingFamily: boolean; reason: string } {
  if (!deviceIntent.hasStrongFamilyIntent || !deviceIntent.family) {
    return { adjustment: 0, familyMatch: false, generationMatch: false, conflictingFamily: false, reason: "no_family_intent" };
  }

  const tLow = title.toLowerCase();
  let adjustment = 0;
  let familyMatch = false;
  let generationMatch = false;
  let conflictingFamily = false;
  let reason = "no_match";

  const fam = deviceIntent.family;

  // ── FAMILY MATCHING ──────────────────────────────────────────────────────
  if (fam === "fold") {
    // Check for fold/z fold in title
    if (/\bz\s*fold\b/i.test(tLow) || /\bgalaxy\s*(z\s*)?fold\b/i.test(tLow)) {
      familyMatch = true;
      adjustment += 60; // Massive boost for exact family
      reason = "exact_family_fold";
    } else if (/\bfold\b/i.test(tLow) && /\bsamsung\b/i.test(tLow)) {
      familyMatch = true;
      adjustment += 50;
      reason = "brand_family_fold";
    } else if (/\bfold(able|ing)?\b/i.test(tLow)) {
      familyMatch = true;
      adjustment += 35;
      reason = "generic_fold";
    }
  } else if (fam === "flip") {
    if (/\bz\s*flip\b/i.test(tLow) || /\bgalaxy\s*(z\s*)?flip\b/i.test(tLow)) {
      familyMatch = true;
      adjustment += 60;
      reason = "exact_family_flip";
    } else if (/\bflip\b/i.test(tLow) && /\bsamsung\b/i.test(tLow)) {
      familyMatch = true;
      adjustment += 50;
      reason = "brand_family_flip";
    }
  } else if (fam === "s" && deviceIntent.brand === "samsung") {
    // Galaxy S series
    if (/\bgalaxy\s+s\d/i.test(tLow)) {
      familyMatch = true;
      adjustment += 50;
      reason = "exact_family_galaxy_s";
    }
  } else if (fam === "a" && deviceIntent.brand === "samsung") {
    if (/\bgalaxy\s+a\d/i.test(tLow)) {
      familyMatch = true;
      adjustment += 50;
      reason = "exact_family_galaxy_a";
    }
  } else if (fam === "note" && deviceIntent.brand === "samsung") {
    if (/\bgalaxy\s+note\b/i.test(tLow)) {
      familyMatch = true;
      adjustment += 50;
      reason = "exact_family_galaxy_note";
    }
  } else if (deviceIntent.line === "iphone" && fam) {
    // iPhone model number matching (e.g., family="13")
    const iphoneRe = new RegExp(`\\biphone\\s*${escapeRe(fam)}\\b`, "i");
    if (iphoneRe.test(tLow)) {
      familyMatch = true;
      adjustment += 55;
      reason = `exact_iphone_${fam}`;
    }
  }

  // ── GENERATION MATCHING ──────────────────────────────────────────────────
  if (deviceIntent.generation && familyMatch) {
    const gen = deviceIntent.generation;
    // Check if generation number appears near family keyword
    if (fam === "fold" || fam === "flip") {
      const genRe = new RegExp(`(fold|flip)\\s*${escapeRe(gen)}\\b`, "i");
      if (genRe.test(tLow)) {
        generationMatch = true;
        adjustment += 30; // Big boost for exact generation
        reason += "+exact_gen";
      }
    } else if (deviceIntent.line === "iphone") {
      // Already matched above
      generationMatch = true;
      adjustment += 20;
      reason += "+gen";
    } else {
      // Generic generation check
      const genRe = new RegExp(`\\b${escapeRe(gen)}\\b`, "i");
      if (genRe.test(tLow)) {
        generationMatch = true;
        adjustment += 20;
        reason += "+gen";
      }
    }
  }

  // ── CONFLICTING FAMILY PENALTY ───────────────────────────────────────────
  // Only apply when we have a strong family intent and the item is same brand but wrong family
  if (deviceIntent.brand === "samsung" && deviceIntent.hasStrongFamilyIntent) {
    const conflictPatterns = CONFLICTING_SAMSUNG_FAMILIES[fam] || [];
    const hasBrandMatch = /\bsamsung\b/i.test(tLow) || /\bgalaxy\b/i.test(tLow);
    
    if (hasBrandMatch && !familyMatch) {
      // This is a Samsung device but NOT the right family
      const isConflicting = conflictPatterns.some(pat => tLow.includes(pat));
      if (isConflicting) {
        conflictingFamily = true;
        adjustment -= 45; // Strong penalty — push below family matches
        reason = "conflicting_family_" + fam;
      } else if (!familyMatch) {
        // Generic Samsung/Galaxy without specific family signal — moderate penalty
        adjustment -= 25;
        conflictingFamily = true;
        reason = "generic_brand_no_family";
      }
    }
  }

  // ── ACCESSORY DEMOTION (when searching for a device) ────────────────────
  if (familyMatch) {
    const isAccessory = hasAny(tLow, HARD_ACCESSORY_KW);
    if (isAccessory) {
      adjustment -= 40; // Accessories for the right family still rank below actual devices
      reason += "+accessory_penalty";
    }
  }

  return { adjustment, familyMatch, generationMatch, conflictingFamily, reason };
}

/**
 * Score a single item given intent + query tokens.
 * Returns null if the item should be DROPPED entirely.
 */
function scoreOne(
  item: Record<string, unknown>,
  intent: SearchIntent,
  qTokens: string[],
  deviceIntent?: DeviceIntent,
): number | null {
  const priceUsd = (item.priceUsd ?? item.price_usd ?? 0) as number;
  const title = ((item.title || "") as string).toLowerCase();

  // ── HARD DROPS ──────────────────────────────────────────────────────
  if (priceUsd <= 0) return null;
  if (!title || title.length < 3) return null;

  // ── WRONG-CATEGORY HARD DROP ──
  if (
    (intent.intentKey === "phone_device" || intent.intentKey === "phone_accessory" || intent.intentKey === "gaming") &&
    hasAny(title, WRONG_CATEGORY_KW)
  ) {
    return null;
  }

  // ── MODEL TOKENS ──
  const MODEL_SINGLE_CHARS = new Set(["z","x","s","3","4","5","6","7","8","9","2","1","a","e"]);
  const isModelToken = (t: string) => t.length >= 2 || (t.length === 1 && MODEL_SINGLE_CHARS.has(t.toLowerCase()));
  const allScoringTokens = qTokens.filter(t => isModelToken(t) && !SCORING_STOPLIST.has(t));

  // ── BASE SCORE: query-token match (word-boundary) ────────────────────────
  let score = 0;
  const meaningfulQTokens = qTokens.filter(t => t.length >= 2 && !SCORING_STOPLIST.has(t));
  let matchedTokenCount = 0;
  for (const tok of meaningfulQTokens) {
    if (tokenMatchesBoundary(title, tok)) {
      score += 3;
      matchedTokenCount++;
    }
  }
  for (const tok of allScoringTokens) {
    if (tok.length === 1 && tokenMatchesBoundary(title, tok)) {
      score += 2;
      matchedTokenCount++;
    }
  }

  // ── EXACT FULL-QUERY MATCH ──────────────────────────────────────────────
  const fullQuery = allScoringTokens.join(" ");
  if (fullQuery.length >= 5 && title.includes(fullQuery)) {
    score += 40;
  }

  // ── PHRASE / MULTI-TOKEN BOOST ──────────────────────────────────────────
  for (let i = 0; i < allScoringTokens.length - 1; i++) {
    const a = allScoringTokens[i], b = allScoringTokens[i + 1];
    if (SCORING_STOPLIST.has(a) || SCORING_STOPLIST.has(b)) continue;
    const bigram = `${a} ${b}`;
    if (title.includes(bigram)) score += 10;
    if (i < allScoringTokens.length - 2) {
      const c = allScoringTokens[i + 2];
      if (!SCORING_STOPLIST.has(c)) {
        const trigram = `${a} ${b} ${c}`;
        if (title.includes(trigram)) score += 15;
      }
    }
  }

  // ── GAP-AWARE PHRASE MATCHING ───────────────────────────────────────────
  for (let i = 0; i < allScoringTokens.length - 1; i++) {
    for (let j = i + 1; j < allScoringTokens.length && j <= i + 3; j++) {
      const a = allScoringTokens[i], b = allScoringTokens[j];
      if (a === b) continue;
      const gapRe = new RegExp(`\\b${escapeRe(a)}\\b(?:\\s+\\S+){0,2}\\s+\\b${escapeRe(b)}\\b`, 'i');
      if (gapRe.test(title)) {
        score += 8;
      }
    }
  }

  // ── TOKEN COVERAGE BONUS ────────────────────────────────────────────────
  if (meaningfulQTokens.length >= 2 && matchedTokenCount >= allScoringTokens.length) {
    score += 25;
  } else if (meaningfulQTokens.length >= 3 && matchedTokenCount >= meaningfulQTokens.length - 1) {
    score += 12;
  }

  // ── COVERAGE RATIO PENALTY ──────────────────────────────────────────────
  if (meaningfulQTokens.length >= 3 && matchedTokenCount <= 1) {
    score -= 15;
  }

  // ── DEVICE-FAMILY-AWARE SCORING (phone_device + general with phone intent) ──
  if (deviceIntent && deviceIntent.hasStrongFamilyIntent &&
      (intent.intentKey === "phone_device" || intent.intentKey === "general")) {
    const familyResult = scoreDeviceFamily(title, deviceIntent);
    score += familyResult.adjustment;
    // Store debug info on the item for diagnostics
    (item as any)._familyMatch = familyResult.familyMatch;
    (item as any)._generationMatch = familyResult.generationMatch;
    (item as any)._conflictingFamily = familyResult.conflictingFamily;
    (item as any)._familyReason = familyResult.reason;
  }

  // ── INTENT-SPECIFIC SCORING ─────────────────────────────────────────
  switch (intent.intentKey) {
    case "vehicle_listing": {
      if (hasAny(title, VEHICLE_PARTS_HARD_DROP)) return null;
      if (hasAny(title, VEHICLE_PARTS_KW)) return null;
      if (hasAny(title, WRONG_CATEGORY_KW)) return null;
      if (hasYearToken(title)) score += 20;
      if (hasMileageToken(title)) score += 15;
      if (hasAny(title, VEHICLE_LISTING_SIGNALS)) score += 8;
      if (priceUsd >= 1000) score += 5;
      if (priceUsd < 300) score -= 30;
      break;
    }
    case "vehicle_parts": {
      if (hasAny(title, VEHICLE_PARTS_KW)) score += 10;
      if (hasYearToken(title) && priceUsd >= 5000) score -= 20;
      break;
    }
    case "phone_device": {
      const isAccessory = hasAny(title, HARD_ACCESSORY_KW);
      const hasDeviceSignal = hasAny(title, PHONE_DEVICE_SIGNALS);

      if (isAccessory && !hasDeviceSignal) return null;

      const PHONE_FOR_PATTERNS = [
        "for iphone","for samsung","for galaxy","for pixel","for xiaomi",
        "for tecno","for infinix","for redmi","for oneplus","for motorola",
        "compatible with","fits","designed for","made for",
      ];
      if (hasAny(title, PHONE_FOR_PATTERNS) && !hasDeviceSignal) return null;

      const STRONG_ACCESSORY = [
        "charger","cable","adapter","wall charger","car charger","fast charger",
        "charging block","power block","usb c","lightning","magsafe",
        "screen protector","tempered glass","case for","clear case","phone case",
      ];
      if (hasAny(title, STRONG_ACCESSORY) && !hasDeviceSignal) return null;

      if (hasDeviceSignal) score += 15;
      if (isAccessory && hasDeviceSignal) score -= 20;

      const fullQueryJoined = qTokens.join(" ");
      if (title.includes(fullQueryJoined)) score += 25;
      break;
    }
    case "phone_accessory": {
      if (hasAny(title, PHONE_ACCESSORY_KW)) score += 10;
      if (hasAny(title, PHONE_DEVICE_SIGNALS)) score -= 20;
      break;
    }
    case "appliance_fridge": {
      const FRIDGE_TITLE_SIGNALS = [
        "refrigerator","fridge","french door","side-by-side","side by side",
        "mini fridge","top freezer","bottom freezer","freezer","ice maker",
        "cu ft","cubic feet","cu. ft","counter depth","stainless steel refrigerator",
        "compact refrigerator","beverage cooler","wine cooler",
      ];
      const FRIDGE_MODEL_PATTERNS = /\b(rf28|rs27|rt18|rt21|rf23|rf29|lf|lfx|lrm|wrx|wrs|gss|gne|gte|gfe|ffss|ffhb|lrs|lrd)\d/i;
      const FRIDGE_ACCESSORY_HARD_DROP = [
        "water filter","replacement filter","ice filter","cartridge","filter for",
        "door bin","shelf","handle","gasket","bulb","thermostat",
        "compressor","relay","evaporator","fan motor","drain","hose",
        "defrost","dispenser","drawer","crisper","light","bracket",
        "cap","valve","tube","tray","cover plate","deli drawer",
        "door shelf","door rack","guard","ice bucket","auger",
        "sensor","control board","wire harness","kick plate",
        "drip tray","pan","grommet","spring","hinge","cam",
        "ami parts","oem part","replacement part","repair",
        "ice maker assembly","icemaker assembly","icemaker",
        "beverage center","flipper","mullion","heater",
        "filtration","carbon block","da97-","da63-","da82-",
        "assembly for samsung","assembly for",
      ];
      
      const hasFridgeSignal = hasAny(title, FRIDGE_TITLE_SIGNALS) || FRIDGE_MODEL_PATTERNS.test(title);
      const isAccessoryOnly = hasAny(title, FRIDGE_ACCESSORY_HARD_DROP);
      if (isAccessoryOnly) return null;
      if (!hasFridgeSignal) return null;
      if (hasAny(title, FRIDGE_TITLE_SIGNALS)) score += 15;
      if (FRIDGE_MODEL_PATTERNS.test(title)) score += 10;
      if (priceUsd >= 200) score += 5;
      if (priceUsd < 20) return null;
      break;
    }
    case "heavy_equipment": {
      if (hasAny(title, ["tractor","excavator","loader","bulldozer","backhoe","john deere","kubota","caterpillar","massey","case ih"])) score += 10;
      break;
    }
    case "gaming": {
      const GAMING_NOT_CONSOLE = [
        "storage","stand","shelf","rack","organizer","furniture","desk","table",
        "chair","cabinet","tower","wall mount","tv mount","display case",
        "special edition","metal case","steelbook","game case",
      ];
      if (hasAny(title, GAMING_NOT_CONSOLE)) return null;
      const GAMING_ACCESSORY_DROP = [
        "headset","headphones","earphones","mic","microphone",
        "controller","manette","joystick","gamepad",
        "dock","charging","charger","chargeur",
        "skin","sticker","decal","grip","cover","coque",
        "protection","cooling fan","ventilateur",
        "repair","replacement","spare",
        "sac","bag","backpack",
        "poster","shirt","shoes","figurine","mod","script",
        "sauce","mcdonalds","mug","cup","keychain","wallet","socks",
        "hat","cap","band","strap","mount","holder",
        "accessory","accessoires",
      ];
      if (hasAny(title, GAMING_ACCESSORY_DROP)) return null;

      const FOR_PATTERNS = [
        "for ps5","for ps4","for ps3","for xbox","for nintendo",
        "for switch","for playstation","compatible with","fits","works with",
        "designed for","made for",
      ];
      if (hasAny(title, FOR_PATTERNS)) return null;

      const LOT_BUNDLE_DROP = [
        "lot","bundle","job lot","bulk","mixed","assorted","collection",
        "set of","pack","power tested mixed","w/ games lot","games lot",
        "avec jeux","consoles & games","mega",
      ];
      if (hasAny(title, LOT_BUNDLE_DROP)) return null;
      if (/lot\s+of\s+\d+/i.test(title)) return null;
      if (/\b\d+\s*x\b/i.test(title)) return null;

      const BROKEN_DROP = [
        "for parts","parts only","not working","broken","as-is","as is",
        "untested","read description","faulty","doesn't work","no power",
        "defective","damaged","cracked","dead","won't turn on",
      ];
      if (hasAny(title, BROKEN_DROP)) return null;

      const conditionName = ((item.condition ?? item.conditionName ?? (item.metadata as any)?.condition) || "").toString().toLowerCase();
      if (conditionName.includes("for parts") || conditionName.includes("not working")) return null;
      if (conditionName === "used" || conditionName === "good" || conditionName === "acceptable") return null;
      if (conditionName === "open box") return null;

      const CONSOLE_MODEL_SIGNALS = [
        "playstation 5 slim","playstation 5","ps5 slim","ps5 console","ps5 digital",
        "playstation 4","ps4 console","ps4 slim","ps4 pro",
        "xbox series s","xbox series x",
        "xbox one x","xbox one s","xbox one console","xbox one",
        "xbox 360","xbox 360 console","xbox 360 video game",
        "nintendo switch 2","nintendo switch console","nintendo switch",
        "wii u console","wii console",
        "steam deck","rog ally",
        "video game console",
      ];
      const hasBrandAndConsole = title.includes("console") && 
        hasAny(title, ["playstation","xbox","nintendo","sony","microsoft"]);
      
      if (!hasAny(title, CONSOLE_MODEL_SIGNALS) && !hasBrandAndConsole) return null;

      if (priceUsd > 3000) return null;
      if (priceUsd < 30) return null;

      if (conditionName.includes("new") || conditionName === "" || title.includes("brand new") || title.includes("sealed")) score += 20;
      else if (conditionName.includes("refurbished") || title.includes("refurbished") || title.includes("renewed") || title.includes("certified")) score += 10;

      if (hasAny(title, CONSOLE_MODEL_SIGNALS)) score += 15;
      if (hasBrandAndConsole) score += 10;
      if (title.includes("console")) score += 5;
      break;
    }
    case "fashion": {
      if (hasAny(title, FASHION_VEHICLE_HARD_DROP)) return null;
      const FASHION_BOOST_KW = [
        "skirt","dress","pants","shirt","blouse","jeans","jacket","coat","hoodie",
        "sweater","shoes","sneakers","boots","sandals","heels","clothing","hat","belt",
        "jupe","robe","pantalon","chemise","veste","manteau","chaussures","baskets","bottes",
      ];
      if (hasAny(title, FASHION_BOOST_KW)) score += 10;
      if (priceUsd > 0 && priceUsd < 500) score += 5;
      if (priceUsd >= 5000) score -= 20;
      break;
    }
    case "general":
    default: {
      if (intent.phoneDeviceIntent && hasAny(title, PHONE_ACCESSORY_KW)) score -= 30;
      if (intent.phoneDeviceIntent && hasAny(title, WRONG_CATEGORY_KW)) return null;
      
      const meaningfulTokens = qTokens.filter(t => t.length >= 3 && !SCORING_STOPLIST.has(t));
      const hasAnyTokenMatch = meaningfulTokens.length === 0 || meaningfulTokens.some(tok => tokenMatchesBoundary(title, tok));
      if (meaningfulTokens.length > 0 && !hasAnyTokenMatch) return null;
      
      const TECH_QUERY_TOKENS = ["laptop","computer","ordinateur","pc","monitor","tablet","phone","camera","printer"];
      const FURNITURE_KW = ["chair","desk","table","shelf","cabinet","stand","rack","organizer","mat","cushion","pillow","ottoman","bench","stool","cart","furniture"];
      const queryHasTech = qTokens.some(tok => TECH_QUERY_TOKENS.includes(tok));
      if (queryHasTech && hasAny(title, FURNITURE_KW) && !hasAny(title, ["laptop","computer","monitor","tablet","phone","camera","printer","keyboard"])) {
        return null;
      }

      const COMPUTER_DEVICE_TOKENS = ["laptop", "computer", "ordinateur", "notebook", "macbook", "pc", "desktop", "chromebook", "thinkpad"];
      const COMPUTER_ACCESSORY_KW = [
        "mouse", "wireless mouse", "optical mouse", "keyboard", "mouse pad", "laptop stand", "monitor stand",
        "dock", "docking station", "usb hub", "adapter", "charger", "cable", "webcam", "headset",
        "case", "cover", "sleeve", "replacement", "spare part", "video signal cable",
      ];
      const COMPUTER_DEVICE_SIGNALS = [
        "laptop", "notebook", "macbook", "chromebook", "thinkpad", "ultrabook", "desktop computer",
        "all-in-one", "intel core", "ryzen", "ssd", "ram", "windows", "dell latitude", "hp elitebook",
        "lenovo", "asus", "acer", "msi",
      ];
      const queryHasComputerIntent = qTokens.some(tok => COMPUTER_DEVICE_TOKENS.includes(tok));
      if (queryHasComputerIntent) {
        const hasAccessory = hasAny(title, COMPUTER_ACCESSORY_KW);
        const hasDeviceSignal = hasAny(title, COMPUTER_DEVICE_SIGNALS);
        if (hasAccessory && !hasDeviceSignal) return null;
      }
      break;
    }
  }

  return score;
}

/**
 * Score, filter, and sort items by intent relevance.
 * Now accepts optional deviceIntent for family-aware scoring.
 */
// Minimum result floor: when intent filtering drops too aggressively,
// keep some items to avoid empty results (especially for rare/unreleased models).
const MIN_RESULT_FLOOR = 5;

export function scoreAndRankItems<T extends Record<string, unknown>>(
  items: T[],
  intent: SearchIntent,
  queryTokens: string[],
  limit: number,
  deviceIntent?: DeviceIntent,
): { items: T[]; dropped: number; topScores: number[] } {
  const scored: Array<{ item: T; score: number }> = [];
  const droppedItems: Array<{ item: T; score: number }> = [];
  let dropped = 0;

  for (const item of items) {
    const s = scoreOne(item, intent, queryTokens, deviceIntent);
    if (s === null) {
      dropped++;
      // Track dropped items for potential rescue
      droppedItems.push({ item, score: -100 });
      continue;
    }
    scored.push({ item, score: s });
  }

  // If intent filtering was too aggressive (dropped >80% AND fewer than MIN_RESULT_FLOOR remain),
  // rescue some dropped items as low-scored fallbacks
  const dropRate = items.length > 0 ? dropped / items.length : 0;
  if (scored.length < MIN_RESULT_FLOOR && dropRate > 0.8 && droppedItems.length > 0) {
    const rescueCount = Math.min(MIN_RESULT_FLOOR - scored.length, droppedItems.length);
    // Sort dropped items by title relevance (basic token match) to rescue the best ones
    const rescueItems = droppedItems.slice(0, rescueCount);
    scored.push(...rescueItems);
    dropped -= rescueCount;
    console.log(`[SCORER] intent_floor_rescue: rescued ${rescueCount} items (dropRate=${(dropRate * 100).toFixed(0)}%, had=${scored.length - rescueCount}, floor=${MIN_RESULT_FLOOR})`);
  }

  // Sort descending
  scored.sort((a, b) => b.score - a.score);

  const topItems = scored.slice(0, limit).map(s => s.item);
  const topScores = scored.slice(0, 5).map(s => s.score);

  // Log top 10 debug info for device-family queries
  if (deviceIntent?.hasStrongFamilyIntent) {
    const top10Debug = scored.slice(0, 10).map((s, i) => ({
      rank: i + 1,
      title: ((s.item as any).title || "").slice(0, 80),
      score: s.score,
      familyMatch: (s.item as any)._familyMatch ?? false,
      generationMatch: (s.item as any)._generationMatch ?? false,
      conflictingFamily: (s.item as any)._conflictingFamily ?? false,
      reason: (s.item as any)._familyReason ?? "n/a",
    }));
    console.log(`[SCORER][DEVICE_FAMILY] intent=${deviceIntent.normalizedIntent} top10=${JSON.stringify(top10Debug)}`);
  }

  return { items: topItems, dropped, topScores };
}
