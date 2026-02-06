/**
 * Section Profiles - Strict include/exclude keyword sets for mobile sections
 * 
 * Each section has:
 * - includeAny: item must match at least one keyword to be included
 * - excludeAny: item is rejected if it matches any exclude keyword
 * - minItems: target count per section
 * - backfill: when pool filtering yields < minItems, query catalog_items DB
 *
 * Used by catalog-home and catalog-home-v2 for mobile multi-section responses.
 */

// ─── TYPES ────────────────────────────────────────────────────────────────────

export interface SectionProfile {
  key: string;
  title: { en: string; fr: string };
  includeAny: string[];
  excludeAny: string[];
  preferProviders?: ("amazon" | "ebay")[];
  minItems: number;
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
  "car","cars","truck","trucks","suv","pickup","van","sedan","coupe","hatchback",
  "motorcycle","motorbike","scooter","atv","utv","powersports",
  "rv","camper","trailer","boat","jetski","watercraft",
  "ebay motors","motors","vin","mileage","dealer","auction",
];

const PARTS_WORDS = [
  "part","parts","oem","aftermarket","replacement",
  "bumper","fender","hood","mirror","headlight","taillight","rim","wheel","tire","tyre",
  "brake","rotor","caliper","spark plug","filter","oil","engine","transmission",
  "radiator","suspension","shock","strut","axle","bearing","belt","sensor","catalytic",
  "exhaust","muffler","intake","turbo","ecu","alternator","starter",
  "carplay","android auto","dash cam","floor mat","seat cover",
  "car stereo","car vacuum","car charger","car mount","car phone",
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
  "gaming","controller","joy-con","console","steam deck",
  "game disc","video game",
];

const CLOTHING_WORDS = [
  "shirt","t-shirt","tee","hoodie","jacket","coat","pants","jeans","dress","skirt",
  "shoes","sneakers","boots","sandals","nike","adidas","puma","reebok","jordan",
];

const HOME_WORDS = [
  "sofa","couch","bed","mattress","table","chair","dresser","wardrobe","cabinet",
  "lamp","rug","curtain","kitchen","microwave","blender","toaster","vacuum cleaner",
  "tool","drill","screwdriver","wrench","garden","outdoor","patio","storage",
  "furniture","decor","home",
];

const TOYS_WORDS = [
  "toy","toys","lego","doll","action figure","rc car","remote control","kids toy",
  "puzzle","board game","playset","barbie","figure",
];

const SPORTS_WORDS = [
  "sport","sports","camping","tent","hiking","fitness","gym",
  "dumbbell","treadmill","bicycle","soccer","basketball","football","boxing",
  "yoga","running","exercise","tennis",
];

const ELECTRONICS_WORDS = [
  "laptop","notebook","macbook","desktop","pc","monitor","tv","television",
  "camera","dslr","mirrorless","speaker","bluetooth speaker","router","ssd","gpu",
  "tablet","audio","bluetooth",
];

const REFURB_WORDS = [
  "renewed","refurbished","reconditioned","open box","certified refurbished","remanufactured",
];

// ─── SECTION PROFILES ─────────────────────────────────────────────────────────

export const SECTION_PROFILES: SectionProfile[] = [
  {
    key: "phones",
    title: { en: "Phones", fr: "Téléphones" },
    includeAny: PHONE_WORDS,
    excludeAny: VEHICLE_CORE.concat(PARTS_WORDS, GAMING_WORDS),
    preferProviders: ["amazon", "ebay"],
    minItems: 20,
  },
  {
    key: "electronics",
    title: { en: "Electronics", fr: "Électronique" },
    includeAny: ELECTRONICS_WORDS.concat(PHONE_ACCESSORIES),
    excludeAny: VEHICLE_CORE,
    preferProviders: ["amazon", "ebay"],
    minItems: 20,
  },
  {
    key: "vehicles",
    title: { en: "Vehicles", fr: "Véhicules" },
    includeAny: VEHICLE_CORE,
    excludeAny: PHONE_WORDS.concat(PHONE_ACCESSORIES, GAMING_WORDS, TOYS_WORDS),
    preferProviders: ["ebay", "amazon"],
    minItems: 12,
  },
  {
    key: "parts_accessories",
    title: { en: "Parts & Accessories", fr: "Pièces & Accessoires" },
    includeAny: PARTS_WORDS,
    excludeAny: PHONE_WORDS.concat(GAMING_WORDS, TOYS_WORDS),
    preferProviders: ["ebay", "amazon"],
    minItems: 12,
  },
  {
    key: "gaming",
    title: { en: "Gaming", fr: "Jeux Vidéo" },
    includeAny: GAMING_WORDS,
    excludeAny: VEHICLE_CORE.concat(PARTS_WORDS),
    preferProviders: ["amazon", "ebay"],
    minItems: 12,
  },
  {
    key: "clothing",
    title: { en: "Clothing & Fashion", fr: "Vêtements et Mode" },
    includeAny: CLOTHING_WORDS,
    excludeAny: VEHICLE_CORE.concat(PARTS_WORDS),
    preferProviders: ["amazon", "ebay"],
    minItems: 12,
  },
  {
    key: "home_garden",
    title: { en: "Home & Garden", fr: "Maison & Jardin" },
    includeAny: HOME_WORDS,
    excludeAny: VEHICLE_CORE.concat(PARTS_WORDS, PHONE_WORDS),
    preferProviders: ["amazon", "ebay"],
    minItems: 12,
  },
  {
    key: "toys",
    title: { en: "Toys", fr: "Jouets" },
    includeAny: TOYS_WORDS,
    excludeAny: VEHICLE_CORE.concat(PARTS_WORDS),
    preferProviders: ["amazon", "ebay"],
    minItems: 10,
  },
  {
    key: "sporting_goods",
    title: { en: "Sporting Goods", fr: "Articles de Sport" },
    includeAny: SPORTS_WORDS,
    excludeAny: VEHICLE_CORE.concat(PARTS_WORDS),
    preferProviders: ["amazon", "ebay"],
    minItems: 10,
  },
  {
    key: "refurbished",
    title: { en: "Refurbished", fr: "Reconditionnés" },
    includeAny: REFURB_WORDS,
    excludeAny: [],
    preferProviders: ["amazon", "ebay"],
    minItems: 10,
  },
];

// ─── FILTERING ────────────────────────────────────────────────────────────────

function normText(item: SectionItem): string {
  return [item.title, item.product_url, item.productUrl]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function matchesAny(text: string, words: string[]): boolean {
  for (const w of words) {
    if (text.includes(w.toLowerCase())) return true;
  }
  return false;
}

export function filterItemsForProfile(
  items: SectionItem[],
  profile: SectionProfile
): SectionItem[] {
  const out: SectionItem[] = [];
  for (const item of items) {
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

  try {
    // Build OR filter from top 6 include keywords
    const queryKeywords = profile.includeAny.slice(0, 6);
    const orClauses = queryKeywords
      .map(kw => `title.ilike.*${kw.replace(/ /g, "+")}*`)
      .join(",");

    const url = `${supabaseUrl}/rest/v1/catalog_items?` +
      `provider=in.(amazon,ebay)&price_usd=gt.0&image_url=not.is.null&is_disallowed=eq.false` +
      `&or=(${orClauses})&order=updated_at.desc.nullslast&limit=${needed * 3}`;

    const res = await fetch(url, {
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
      },
    });

    if (!res.ok) {
      console.warn(`[SECTION_PROFILES] backfill HTTP ${res.status} for ${profile.key}`);
      return [];
    }

    const rows = await res.json() as Array<Record<string, unknown>>;
    if (!Array.isArray(rows) || rows.length === 0) return [];

    // Map DB rows to SectionItem
    const mapped: SectionItem[] = rows.map(row => ({
      id: `${row.provider}_${row.provider_product_id}`,
      provider: row.provider as string,
      provider_product_id: row.provider_product_id as string,
      title: (row.title as string) || "Product",
      price_usd: row.price_usd as number | null,
      priceUsd: row.price_usd as number | null,
      currency: "USD",
      image_url: row.image_url as string | null,
      imageUrl: row.image_url as string | null,
      product_url: row.product_url as string | null,
      productUrl: row.product_url as string | null,
      in_stock: true,
      segment: row.segment as string | undefined,
    }));

    // Apply strict filter + dedupe against usedIds
    return filterItemsForProfile(mapped, profile)
      .filter(item => !usedIds.has(item.id))
      .slice(0, needed);
  } catch (e) {
    console.warn(`[SECTION_PROFILES] backfill error for ${profile.key}: ${e}`);
    return [];
  }
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

  // Initialize buckets
  for (const profile of SECTION_PROFILES) {
    sectionBuckets[profile.key] = [];
  }

  // PHASE 1: Strict filter from pool
  if (pool && pool.length > 0) {
    for (const profile of SECTION_PROFILES) {
      const filtered = filterItemsForProfile(pool, profile)
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
      // Only backfill if significantly under target (< 5 items)
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
    sections.push({
      key: profile.key,
      title: lang === "fr" ? profile.title.fr : profile.title.en,
      title_fr: profile.title.fr,
      title_en: profile.title.en,
      items: sectionBuckets[profile.key],
    });
  }

  const totalItems = sections.reduce((sum, s) => sum + s.items.length, 0);
  const sectionSummary = sections.map(s => `${s.key}=${s.items.length}`).join(" ");
  console.log(`[SECTION_PROFILES] built sections total=${totalItems} backfilled=${backfillTasks.length} ${sectionSummary}`);

  return sections;
}
