/**
 * Section Profiles - Strict include/exclude keyword sets for mobile sections
 * 
 * Each section has:
 * - includeAny: item must match at least one keyword to be included
 * - excludeAny: item is rejected if it matches any exclude keyword
 * - minItems: target count per section
 * - backfill: when pool filtering yields < minItems, query catalog_items DB
 *
 * IMPORTANT: Matching uses word-boundary regex for short keywords (≤4 chars)
 * and includes() for longer keywords/phrases. This prevents false positives
 * like "tee" matching "steel" or "car" matching "carplay".
 */

import { bestProductImage } from "./imageValidator.ts";
import { isDisallowedItem } from "./contentBlocker.ts";
import { postProcessSection } from "./sectionPostProcess.ts";

// ─── TYPES ────────────────────────────────────────────────────────────────────

export interface SectionProfile {
  key: string;
  title: { en: string; fr: string };
  includeAny: string[];
  excludeAny: string[];
  preferProviders?: string[];
  /** If true, NEVER fall back to other providers — section stays empty if preferred providers have no items */
  strictProviders?: boolean;
  minItems: number;
  minPrice?: number;
  /** Per-brand diversity queries for backfill (each queried separately, results interleaved) */
  diversityQueries?: string[];
}

export interface SectionItem {
  id: string;
  provider: string;
  provider_product_id: string;
  title: string;
  price_usd: number | null;
  priceUsd: number | null;
  currency: string;
  image_url: string | null;
  imageUrl: string | null;
  product_url: string | null;
  productUrl: string | null;
  in_stock: boolean;
  segment?: string;
  [k: string]: unknown;
}

// ─── KEYWORD LISTS ────────────────────────────────────────────────────────────

const VEHICLE_CORE = [
  "used car","new car","cars","truck","trucks","suv",
  "pickup truck","pickup 4x4",
  "sedan","coupe","hatchback",
  "motorcycle","motorbike","scooter","atv","utv","powersports",
  "rv","camper","trailer","boat","jetski","watercraft",
  "ebay motors","vin","mileage","dealer","auction",
  // CarGurus/Carvana title patterns ("Used [Make] [Model] for Sale")
  "for sale","cargurus","carvana",
  "toyota","honda","ford","chevrolet","chevy","bmw","mercedes","audi",
  "nissan","hyundai","kia","subaru","mazda","lexus","infiniti","acura",
  "dodge","jeep","ram","chrysler","buick","cadillac","gmc","lincoln",
  "porsche","tesla","volvo","jaguar","land rover","range rover",
  "volkswagen","mitsubishi","genesis",
];

const PARTS_WORDS = [
  // Actual mechanical parts only — removed accessories (dash cam, car vacuum, seat cover, floor mat, etc.)
  "oem","aftermarket","replacement",
  "bumper","fender","hood","mirror","headlight","taillight","rim","wheel","tire","tyre",
  "brake","rotor","caliper","spark plug","filter","engine","transmission",
  "radiator","suspension","shock","strut","axle","bearing","belt","sensor","catalytic",
  "exhaust","muffler","intake","turbo","ecu","alternator","starter",
];

const PHONE_WORDS = [
  "iphone","ipad","samsung galaxy","pixel","oneplus","xiaomi","huawei",
  "smartphone","cell phone","mobile phone","android phone","unlocked phone",
  "galaxy s2","galaxy s3","galaxy a",
];

const PHONE_ACCESSORIES = [
  "phone case","screen protector","tempered glass","charging cable","usb-c cable",
  "magsafe","wireless charger","power bank","earbuds","airpods","headphones",
  "phone stand","phone holder","phone mount","phone charger",
];

const GAMING_WORDS = [
  "playstation","ps5","ps4","xbox","series x","series s","nintendo","switch",
  "controller","joy-con","console","steam deck",
  "game disc","video game",
  "gaming laptop","gaming headset","gaming keyboard","gaming mouse",
  "gaming monitor","gaming chair","rgb keyboard","gaming pc",
  "dualsense","dualshock",
];

const CLOTHING_WORDS = [
  // Removed "tee" (matches "steel","teeth","steer") — use "t-shirt" instead
  "shirt","t-shirt","tee shirt","hoodie","jacket","coat","pants","jeans","dress","skirt",
  "shoes","sneakers","boots","sandals","nike","adidas","puma","reebok","jordan",
];

const HOME_WORDS = [
  // Removed "home" (too generic — matches everything)
  "sofa","couch","bed","mattress","table","chair","dresser","wardrobe","cabinet",
  "lamp","rug","curtain","kitchen","microwave","blender","toaster","vacuum cleaner",
  "drill","screwdriver","wrench","garden","patio","storage",
  "furniture","decor",
];

const KITCHEN_WORDS = [
  "air fryer","blender","coffee maker","coffee machine","rice cooker",
  "pressure cooker","kettle","toaster","microwave","instant pot",
  "slow cooker","food processor","juicer","mixer","espresso",
  "bread maker","waffle maker","electric grill","induction cooktop",
  "kitchen appliance","smart kitchen",
];

const SPORTS_WORDS = [
  // Removed "sport","sports","outdoor" (too generic)
  "camping","tent","hiking","fitness","gym",
  "dumbbell","treadmill","bicycle","soccer","basketball","football","boxing",
  "yoga","running","exercise","tennis",
];

const ELECTRONICS_WORDS = [
  "laptop","notebook","macbook","desktop","monitor","tv","television",
  "camera","dslr","mirrorless","speaker","bluetooth speaker","router","ssd","gpu",
  "tablet","ipad","headphones","earbuds","airpods","soundbar","projector","printer",
  "webcam","drone","smartwatch","smart watch","apple watch","galaxy watch","bluetooth",
];

const REFURB_WORDS = [
  "renewed","refurbished","reconditioned","open box","certified refurbished","remanufactured",
];

// ─── CROSS-CATEGORY EXCLUSION HELPERS ─────────────────────────────────────────

const PHONE_EXCLUDE = [
  "phone","iphone","samsung","galaxy","pixel","smartphone","cell phone","mobile phone",
  "case","charger","airpods","earbuds","screen protector","magsafe",
];

const VEHICLE_EXCLUDE = [
  "truck","suv","motorcycle","vin","mileage","ebay motors","motors",
  "sedan","coupe","trailer","boat",
];

const GAMING_EXCLUDE = [
  "playstation","ps5","ps4","xbox","nintendo","switch","console","controller","joy-con",
];

const PARTS_EXCLUDE = [
  "bumper","brake","headlight","oem","aftermarket","rotor","fender","taillight",
  "exhaust","muffler","radiator","transmission",
];

// Vehicle-specific accessory exclusions (things with "car" in name but aren't vehicles)
const VEHICLE_ACCESSORY_EXCLUDE = [
  "vacuum","stereo","radio","dash cam","dashcam","seat cover","floor mat",
  "mount","holder","charger","scanner","obd","obd2","diagnostic",
  "jump starter","air freshener","organizer","cleaning","car phone","car mount",
  "car charger","car stereo","car vacuum","carplay","android auto",
];

// ─── SECTION PROFILES ─────────────────────────────────────────────────────────

export const SECTION_PROFILES: SectionProfile[] = [
  {
    key: "phones",
    title: { en: "Phones", fr: "Téléphones" },
    includeAny: PHONE_WORDS,
    excludeAny: VEHICLE_CORE.concat(PARTS_WORDS, GAMING_WORDS, [
      "phone holder","phone mount","phone stand","car mount","car charger",
      "car adapter","fm transmitter","bluetooth adapter","phone grip",
      "phone case","screen protector","tempered glass","charging cable",
      "power bank","car phone","phone cradle","phone ring","phone wallet",
      "phone sleeve","phone pouch","phone lanyard","phone strap",
      // Generic accessory words — actual phones never have these in the title
      "case","cover","cable","charger","protector","holster","pouch",
      "mount","stand","holder","adapter","strap","sleeve","lanyard",
      "film","sticker","skin","wrap","bumper","bracket","cradle",
      "dock","hub","dongle","splitter","converter","extender",
      "lcd screen","digitizer","replacement screen","repair",
      "belt clip","armband","ring light",
    ]),
    preferProviders: ["rainforest", "amazon"],
    minItems: 30,
    minPrice: 80,
    // PHONES: prefer refurbished / renewed / cheaper devices first
    diversityQueries: [
      "renewed iphone 11 unlocked",
      "renewed iphone 12 unlocked",
      "renewed iphone 13 unlocked",
      "refurbished iphone 13 pro unlocked",
      "refurbished iphone 14 unlocked",
      "renewed samsung galaxy s21 unlocked",
      "renewed samsung galaxy s22 unlocked",
      "refurbished samsung galaxy s23 unlocked",
      "renewed google pixel 6 unlocked",
      "renewed google pixel 7 unlocked",
      "refurbished smartphone unlocked cheap",
      "certified refurbished android phone unlocked",
    ],
  },
  {
    key: "electronics",
    title: { en: "Electronics", fr: "Électronique" },
    includeAny: ELECTRONICS_WORDS.concat(PHONE_ACCESSORIES, [
      "camera","webcam","drone","projector","smart home","printer",
      "smart watch","smartwatch","headset","soundbar",
    ]),
    excludeAny: VEHICLE_CORE.concat(PARTS_WORDS, GAMING_WORDS, [
      "phone holder","car mount","phone stand","fm transmitter",
      "car adapter","seat cover","floor mat","car charger",
      "car phone","phone grip","phone cradle",
    ]),
    preferProviders: ["amazon", "ebay"],
    minItems: 20,
    diversityQueries: [
      "airpods pro wireless",
      "samsung galaxy tab tablet",
      "laptop hp lenovo under 500",
      "apple watch se smartwatch",
      "samsung galaxy watch smartwatch",
      "wireless bluetooth earbuds",
      "portable bluetooth speaker",
      "smart tv 4k",
    ],
  },
  {
    key: "vehicles",
    title: { en: "Vehicles", fr: "Véhicules" },
    includeAny: VEHICLE_CORE,
    excludeAny: PHONE_EXCLUDE.concat(GAMING_EXCLUDE, PARTS_EXCLUDE, VEHICLE_ACCESSORY_EXCLUDE, ELECTRONICS_WORDS, [
      "accessory","accessories","parts","toy","toys","lego","doll",
      "macbook","imac","monitor","display","oled","lcd","ultrawide",
      "microphone","webcam","printer","projector","keyboard","mouse",
      "pickup only","local pickup","in-store pickup",
      "laptop","notebook","desktop","computer","pc","cpu","gpu","ssd","hdd",
      "hard drive","ram","memory","motherboard","graphics card",
      "tablet","ipad","surface","chromebook","server","workstation",
      "router","modem","switch","networking","ethernet",
      "speaker","headphone","earphone","earbud","airpod","soundbar",
      "camera","gopro","dslr","mirrorless","lens","tripod",
      "drone","robot","3d printer","scanner","copier",
      "smart watch","smartwatch","fitbit","garmin","apple watch",
      "tv","television","streaming","roku","firestick","chromecast",
      "vacuum","roomba","air purifier","humidifier","dehumidifier",
      "coffee maker","instant pot","air fryer","toaster","blender",
      "washing machine","dryer","dishwasher","refrigerator","freezer",
      "power tool","cordless drill","impact driver","circular saw",
    ]),
    preferProviders: ["cargurus", "carvana", "ebay"],
    minItems: 12,
    minPrice: 5000,
    diversityQueries: [
      "tesla model 3",
      "tesla model y",
      "toyota camry corolla",
      "honda civic accord",
      "ford explorer mustang",
      "bmw 3 series x3",
      "jeep wrangler cherokee",
      "hyundai tucson sonata",
      "chevrolet equinox malibu",
    ],
  },
  // ─── REMOVED HOMEPAGE SECTIONS ──────────────────────────────────────────
  // The following sections are intentionally disabled and no longer fed to the
  // mobile/web homepage. Clothing will return later sourced from Turkey/China.
  // Removed: parts_accessories, clothing, home_garden, sporting_goods, toys
  {
    key: "kitchen",
    title: { en: "Kitchen Appliances", fr: "Électroménager Cuisine" },
    includeAny: KITCHEN_WORDS,
    excludeAny: VEHICLE_EXCLUDE.concat(PARTS_EXCLUDE, PHONE_EXCLUDE, GAMING_EXCLUDE, [
      "phone case","laptop","tablet","console","controller",
    ]),
    preferProviders: ["amazon", "ebay"],
    minItems: 15,
    diversityQueries: [
      "air fryer kitchen",
      "coffee maker espresso machine",
      "blender smoothie portable",
      "rice cooker electric",
      "pressure cooker instant pot",
      "electric kettle stainless",
      "toaster oven countertop",
      "food processor kitchen",
      "juicer machine electric",
      "waffle maker breakfast",
    ],
  },
  {
    key: "gaming",
    title: { en: "Gaming", fr: "Jeux Vidéo" },
    includeAny: GAMING_WORDS,
    excludeAny: PHONE_EXCLUDE.concat(VEHICLE_EXCLUDE, PARTS_EXCLUDE, VEHICLE_ACCESSORY_EXCLUDE, [
      "office chair","desk chair","ergonomic chair","task chair",
    ]),
    preferProviders: ["amazon", "ebay"],
    minItems: 20,
    diversityQueries: [
      "ps5 console playstation 5",
      "xbox series x console",
      "nintendo switch oled console",
      "ps5 controller dualsense",
      "xbox wireless controller",
      "gaming headset wireless",
      "gaming laptop rtx",
      "gaming monitor 144hz",
      "steam deck handheld",
      "nintendo switch game",
    ],
  },
  {
    key: "refurbished",
    title: { en: "Refurbished", fr: "Reconditionnés" },
    includeAny: REFURB_WORDS,
    excludeAny: ["random lot","mystery box","bulk lot","wholesale","junk"],
    preferProviders: ["amazon", "ebay"],
    minItems: 10,
    diversityQueries: [
      "renewed iphone 13 pro",
      "renewed iphone 14 pro",
      "renewed macbook air m2",
      "renewed macbook pro m3",
      "renewed ipad pro",
      "renewed samsung galaxy s24",
      "renewed pixel 7",
      "renewed airpods pro",
      "renewed ps5 console",
      "renewed dyson",
    ],
  },
];

// ─── LOOKUP HELPER ────────────────────────────────────────────────────────────

/** Look up a section profile by key. Returns null if not found. */
export function getSectionProfile(key: string): SectionProfile | null {
  return SECTION_PROFILES.find(p => p.key === key) ?? null;
}

// ─── FILTERING ────────────────────────────────────────────────────────────────

/**
 * Build text for matching — TITLE ONLY, no URLs.
 * URLs contain search keywords and category paths that cause false positives.
 */
function normText(item: SectionItem): string {
  return (item.title || "").toLowerCase();
}

// Regex cache to avoid recompiling
const regexCache = new Map<string, RegExp>();

function getWordBoundaryRegex(word: string): RegExp {
  let re = regexCache.get(word);
  if (!re) {
    re = new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, "i");
    regexCache.set(word, re);
  }
  return re;
}

/**
 * Smart matching: word-boundary regex for short keywords (≤5 chars),
 * includes() for longer keywords and multi-word phrases.
 * This prevents "tee" matching "steel", "car" matching "carplay", etc.
 */
function smartMatch(text: string, word: string): boolean {
  const w = word.toLowerCase();
  // Multi-word phrases or long words: includes() is fine
  if (w.includes(" ") || w.length > 5) {
    return text.includes(w);
  }
  // Short single words: use word boundary regex
  return getWordBoundaryRegex(w).test(text);
}

function matchesAny(text: string, words: string[]): boolean {
  for (const w of words) {
    if (smartMatch(text, w)) return true;
  }
  return false;
}

export function filterItemsForProfile(
  items: SectionItem[],
  profile: SectionProfile
): SectionItem[] {
  const out: SectionItem[] = [];
  for (const item of items) {
    // Price floor filter (e.g. phones $80+ to exclude accessories)
    if (profile.minPrice) {
      const price = item.price_usd ?? item.priceUsd ?? 0;
      if (price < profile.minPrice) continue;
    }
    const t = normText(item);
    if (!matchesAny(t, profile.includeAny)) continue;
    if (profile.excludeAny.length > 0 && matchesAny(t, profile.excludeAny)) continue;
    out.push(item);
  }
  return out;
}

// ─── BACKFILL (DB BOOTSTRAP PER SECTION) ──────────────────────────────────────

async function backfillForProfile(
  profile: SectionProfile,
  needed: number,
  usedIds: Set<string>
): Promise<SectionItem[]> {
  if (needed <= 0) return [];

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) return [];

  const headers = {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
  };

  const minPriceFilter = profile.minPrice
    ? `price_usd=gte.${profile.minPrice}`
    : `price_usd=gt.0`;

  // ── DIVERSITY MODE: query per-brand and interleave results ──
  if (profile.diversityQueries && profile.diversityQueries.length > 0) {
    try {
      const perBrand = Math.max(8, Math.ceil(needed / profile.diversityQueries.length) + 4);
      const brandFetches = profile.diversityQueries.map(async (q) => {
        const words = q.split(/\s+/).filter(w => w.length > 2);
        const orClauses = words.map(w => `title.ilike.*${w}*`).join(",");
        const url = `${supabaseUrl}/rest/v1/catalog_items?` +
          `${minPriceFilter}&image_url=not.is.null&is_disallowed=eq.false` +
          `&and=(${orClauses})&order=price_usd.asc.nullslast&limit=${perBrand * 3}`;
        const res = await fetch(url, { headers });
        if (!res.ok) return [];
        const rows = await res.json();
        return Array.isArray(rows) ? rows : [];
      });

      const brandResults = await Promise.allSettled(brandFetches);
      const brandBuckets: Array<Record<string, unknown>[]> = brandResults.map(r =>
        r.status === "fulfilled" ? r.value : []
      );

      // Round-robin interleave brands for diversity
      const interleaved: Array<Record<string, unknown>> = [];
      const seenIds = new Set<string>();
      let maxLen = Math.max(...brandBuckets.map(b => b.length));
      for (let i = 0; i < maxLen && interleaved.length < needed * 3; i++) {
        for (const bucket of brandBuckets) {
          if (i < bucket.length) {
            const row = bucket[i];
            const rid = `${row.provider}_${row.provider_product_id}`;
            if (!seenIds.has(rid)) {
              seenIds.add(rid);
              interleaved.push(row);
            }
          }
        }
      }

      if (interleaved.length > 0) {
        const result = mapAndFilter(interleaved, profile, usedIds, needed);
        if (result.length >= Math.min(needed, 5)) {
          console.log(`[SECTION_PROFILES] diversity backfill for ${profile.key}: ${result.length} items from ${profile.diversityQueries.length} queries`);
          return result;
        }
      }
      // Fall through to generic backfill if diversity didn't yield enough
    } catch (e) {
      console.warn(`[SECTION_PROFILES] diversity backfill error for ${profile.key}: ${e}`);
    }
  }

  // ── GENERIC BACKFILL ──
  try {
    const queryKeywords = profile.includeAny
      .filter(kw => kw.length > 3)
      .slice(0, 6);
    
    if (queryKeywords.length === 0) return [];
    
    const orClauses = queryKeywords
      .map(kw => `title.ilike.*${kw.replace(/ /g, "+")}*`)
      .join(",");

    // Use preferProviders if set, otherwise all providers
    const providerFilter = profile.preferProviders && profile.preferProviders.length > 0
      ? `provider=in.(${profile.preferProviders.join(",")})`
      : `provider=in.(amazon,ebay,cargurus,carvana,shein,rainforest)`;

    const url = `${supabaseUrl}/rest/v1/catalog_items?` +
      `${providerFilter}&${minPriceFilter}&image_url=not.is.null&is_disallowed=eq.false` +
      `&or=(${orClauses})&order=price_usd.asc.nullslast&limit=${needed * 3}`;

    const res = await fetch(url, { headers });

    if (!res.ok) {
      console.warn(`[SECTION_PROFILES] backfill HTTP ${res.status} for ${profile.key}`);
      return [];
    }

    const rows = await res.json() as Array<Record<string, unknown>>;
    if (!Array.isArray(rows) || rows.length === 0) {
      // If preferred providers returned nothing, try all providers as fallback
      if (profile.preferProviders && profile.preferProviders.length > 0 && !profile.strictProviders) {
        console.log(`[SECTION_PROFILES] preferred providers empty for ${profile.key}, trying all`);
        const fallbackUrl = `${supabaseUrl}/rest/v1/catalog_items?` +
          `provider=in.(amazon,ebay,cargurus,carvana,shein,rainforest)&${minPriceFilter}&image_url=not.is.null&is_disallowed=eq.false` +
          `&or=(${orClauses})&order=price_usd.asc.nullslast&limit=${needed * 3}`;
        const fallbackRes = await fetch(fallbackUrl, { headers });
        if (fallbackRes.ok) {
          const fallbackRows = await fallbackRes.json() as Array<Record<string, unknown>>;
          if (Array.isArray(fallbackRows) && fallbackRows.length > 0) {
            return mapAndFilter(fallbackRows, profile, usedIds, needed);
          }
        }
      }
      return [];
    }

    return mapAndFilter(rows, profile, usedIds, needed);
  } catch (e) {
    console.warn(`[SECTION_PROFILES] backfill error for ${profile.key}: ${e}`);
    return [];
  }
}

function mapAndFilter(rows: Array<Record<string, unknown>>, profile: SectionProfile, usedIds: Set<string>, needed: number): SectionItem[] {
  const mapped: SectionItem[] = rows
    .map(row => {
      const image = bestProductImage(row.image_url as string | null, row.images as unknown);
      if (!image) return null;
      const blocked = isDisallowedItem({
        title: row.title as string,
        productUrl: row.product_url as string,
        provider: row.provider as string,
        category: row.unified_category as string,
      });
      if (blocked.isDisallowed) return null;
      return {
        id: `${row.provider}_${row.provider_product_id}`,
        provider: row.provider as string,
        provider_product_id: row.provider_product_id as string,
        title: (row.title as string) || "Product",
        price_usd: row.price_usd as number | null,
        priceUsd: row.price_usd as number | null,
        currency: "USD",
        image_url: image,
        imageUrl: image,
        product_url: row.product_url as string | null,
        productUrl: row.product_url as string | null,
        in_stock: true,
        segment: row.segment as string | undefined,
      };
    })
    .filter((item): item is SectionItem => item !== null);

  return filterItemsForProfile(mapped, profile)
    .filter(item => !usedIds.has(item.id))
    .slice(0, needed);
}

// ─── MAIN BUILDER ─────────────────────────────────────────────────────────────

/**
 * Build strict mobile sections from a pool of items.
 * Phase 1: Filter pool items using strict include/exclude per profile
 * Phase 2: Backfill under-populated sections from catalog_items DB
 * Returns all sections (even empty ones) so mobile app gets consistent structure.
 */
export async function buildStrictMobileSections(
  pool: SectionItem[],
  lang: "fr" | "en"
): Promise<Array<{ key: string; title: string; title_fr: string; title_en: string; items: SectionItem[] }>> {
  const usedIds = new Set<string>();
  const sectionBuckets: Record<string, SectionItem[]> = {};

  for (const profile of SECTION_PROFILES) {
    sectionBuckets[profile.key] = [];
  }

  // PHASE 1: Strict filter from pool — prefer specific providers when configured
  if (pool && pool.length > 0) {
    for (const profile of SECTION_PROFILES) {
      let sourcePool = pool;
      if (profile.preferProviders && profile.preferProviders.length > 0) {
        const preferredPool = pool.filter(item =>
          profile.preferProviders!.includes(item.provider)
        );
        if (preferredPool.length >= 5 || profile.strictProviders) {
          sourcePool = preferredPool;
        }
      }

      const filtered = filterItemsForProfile(sourcePool, profile)
        .filter(item => !usedIds.has(item.id))
        .slice(0, profile.minItems);

      for (const item of filtered) {
        usedIds.add(item.id);
      }
      sectionBuckets[profile.key] = filtered;
    }
  }

  // PHASE 2: Backfill sections that are under minItems (run in parallel)
  const backfillTasks: Array<{ key: string; promise: Promise<SectionItem[]> }> = [];

  for (const profile of SECTION_PROFILES) {
    const current = sectionBuckets[profile.key].length;
    if (current < Math.min(profile.minItems, 5)) {
      const needed = profile.minItems - current;
      backfillTasks.push({
        key: profile.key,
        promise: backfillForProfile(profile, needed, usedIds),
      });
    }
  }

  if (backfillTasks.length > 0) {
    const results = await Promise.allSettled(backfillTasks.map(t => t.promise));

    for (let i = 0; i < backfillTasks.length; i++) {
      const result = results[i];
      if (result.status === "fulfilled" && result.value.length > 0) {
        const key = backfillTasks[i].key;
        for (const item of result.value) {
          if (!usedIds.has(item.id)) {
            usedIds.add(item.id);
            sectionBuckets[key].push(item);
          }
        }
      }
    }
  }

  // PHASE 3: Build final sections array
  const sections: Array<{ key: string; title: string; title_fr: string; title_en: string; items: SectionItem[] }> = [];

  for (const profile of SECTION_PROFILES) {
    // Post-process: dedup, remove old products, smart rank, enforce diversity
    const processedItems = postProcessSection(sectionBuckets[profile.key], profile.key);
    sections.push({
      key: profile.key,
      title: lang === "fr" ? profile.title.fr : profile.title.en,
      title_fr: profile.title.fr,
      title_en: profile.title.en,
      items: processedItems,
    });
  }

  const totalItems = sections.reduce((sum, s) => sum + s.items.length, 0);
  const sectionSummary = sections.map(s => `${s.key}=${s.items.length}`).join(" ");
  console.log(`[SECTION_PROFILES] built sections total=${totalItems} backfilled=${backfillTasks.length} ${sectionSummary}`);

  return sections;
}
