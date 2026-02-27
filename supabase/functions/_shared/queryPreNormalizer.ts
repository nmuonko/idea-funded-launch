/**
 * Universal Query Pre-Normalizer
 * 
 * Runs BEFORE AI refiner/translator to deterministically handle
 * high-frequency FR+EN search patterns across all AfriShop categories.
 * Returns a provider-friendly English query and optional inferred category.
 */

const FR_STOP_WORDS = new Set([
  "pour", "de", "du", "des", "le", "la", "les", "un", "une", "en", "a", "à",
  "et", "ou", "avec", "sans", "pas", "très", "tres", "plus",
]);

// Words that should NOT have trailing 's' stripped
const PLURAL_EXCEPTIONS = new Set([
  "jeans", "boots", "ps5", "ps4", "ps3", "airpods", "adidas", "pumas",
  "cross", "bus", "gas", "plus", "bass", "moss", "glass", "less",
]);

function normalize(q: string): string {
  return q.toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/['`]/g, " ")
    .replace(/[-_]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stripStops(tokens: string[]): string[] {
  return tokens.filter(t => !FR_STOP_WORDS.has(t) && t.length > 0);
}

/** Simple plural normalization: remove trailing 's' if word > 3 chars and not exception */
function depluralize(token: string): string {
  if (PLURAL_EXCEPTIONS.has(token)) return token;
  if (token.length > 3 && token.endsWith("s")) return token.slice(0, -1);
  return token;
}

export type InferredCategory =
  | "clothing" | "phones" | "electronics" | "vehicles" | "gaming"
  | "home_garden" | "toys" | "sporting_goods" | "jewelry_watches"
  | "refurbished" | "parts_accessories" | null;

export interface PreNormalizeResult {
  effectiveQuery: string;
  inferredCategory: InferredCategory;
  skipAI: boolean;
  matched: boolean;
  matchRule?: string;
  qNormalizedNoStops?: string; // for debug
}

// ─── DETERMINISTIC SYNONYM FALLBACK QUERIES ─────────────────────────────────
// When provider results are low, these provide alternative queries per category.
// Keyed by substring found in effectiveQuery → list of fallback queries to try.

const CLOTHING_SYNONYMS: Record<string, string[]> = {
  "men's pants": ["mens pants", "men trousers", "men's trousers", "chino pants men"],
  "women's pants": ["womens pants", "women trousers", "ladies pants"],
  "pants trousers": ["pants", "trousers", "slacks"],
  "women's dress": ["womens dress", "women dress", "ladies dress"],
  "women dress": ["womens dress", "ladies dress", "dress for women"],
  "women skirt": ["womens skirt", "ladies skirt", "skirt for women"],
  "men shoes": ["mens shoes", "shoes for men", "men's footwear"],
  "women shoes": ["womens shoes", "shoes for women", "ladies shoes"],
  "men clothing": ["mens clothing", "men's apparel", "menswear"],
  "women clothing": ["womens clothing", "women's apparel", "womenswear"],
  "men shirt": ["mens shirt", "men's dress shirt", "button down shirt men"],
  "women shirt": ["womens shirt", "blouse women", "women's top"],
  "sweater": ["pullover", "knit sweater", "crewneck sweater"],
  "jacket": ["coat", "outerwear", "blazer"],
  "sneakers": ["athletic shoes", "running shoes", "trainers"],
  "boots": ["ankle boots", "leather boots", "work boots"],
};

const ELECTRONICS_SYNONYMS: Record<string, string[]> = {
  "headphones": ["earphones", "over ear headphones", "wireless headphones"],
  "speaker": ["bluetooth speaker", "portable speaker", "wireless speaker"],
  "tablet": ["android tablet", "drawing tablet", "tablet computer"],
  "monitor": ["computer monitor", "display", "screen"],
};

const HOME_GARDEN_SYNONYMS: Record<string, string[]> = {
  "refrigerator": ["fridge", "top freezer refrigerator", "french door refrigerator"],
  "washing machine": ["washer", "laundry machine", "front load washer"],
  "air conditioner": ["AC unit", "portable air conditioner", "window AC"],
  "generator": ["portable generator", "power generator", "home generator"],
};

const VEHICLE_SYNONYMS: Record<string, string[]> = {
  "used car": ["pre-owned car", "second hand car", "used vehicle"],
  "motorcycle": ["motorbike", "used motorcycle", "street motorcycle"],
};

const GAMING_SYNONYMS: Record<string, string[]> = {
  "gaming console": ["video game console", "game system"],
  "controller": ["gamepad", "game controller", "wireless controller"],
};

const CATEGORY_SYNONYM_MAP: Record<string, Record<string, string[]>> = {
  clothing: CLOTHING_SYNONYMS,
  electronics: ELECTRONICS_SYNONYMS,
  home_garden: HOME_GARDEN_SYNONYMS,
  vehicles: VEHICLE_SYNONYMS,
  gaming: GAMING_SYNONYMS,
};

/**
 * Returns deterministic synonym fallback queries for a given effectiveQuery + category.
 * Used when provider results are low (<10) to retry with alternative phrasing.
 */
export function getSynonymFallbackQueries(
  effectiveQuery: string,
  category: InferredCategory,
): string[] {
  if (!category) return [];
  const synonymMap = CATEGORY_SYNONYM_MAP[category];
  if (!synonymMap) return [];
  const eqLower = effectiveQuery.toLowerCase();
  for (const [trigger, synonyms] of Object.entries(synonymMap)) {
    if (eqLower.includes(trigger.toLowerCase())) {
      // Return synonyms that differ from the original query
      return synonyms.filter(s => s.toLowerCase() !== eqLower);
    }
  }
  return [];
}

// ─── PHRASE MAPS (FR phrase → EN provider query) per category ────────────────

const CLOTHING_PHRASES: Record<string, string> = {
  // jupe
  "jupe": "women skirt", "jupe dame": "women skirt", "jupe femme": "women skirt",
  "jupe homme": "men skirt", "jupe fille": "girls skirt", "jupe enfant": "kids skirt",
  // robe
  "robe": "women dress", "robe dame": "women dress", "robe femme": "women dress",
  "robe soiree": "evening dress", "robe mariee": "wedding dress",
  "robe fille": "girls dress", "robe enfant": "kids dress",
  // chaussure
  "chaussure": "shoes", "chaussure femme": "women shoes", "chaussure dame": "women shoes",
  "chaussure homme": "men shoes", "chaussure enfant": "kids shoes",
  // vetement
  "vetement": "clothing", "vetement femme": "women clothing", "vetement dame": "women clothing",
  "vetement homme": "men clothing", "vetement enfant": "kids clothing",
  // pantalon
  "pantalon": "pants trousers", "pantalon femme": "women's pants", "pantalon homme": "men's pants",
  "pantalon jean": "jeans", "pantalon jean homme": "men's jeans", "pantalon jean femme": "women's jeans",
  "pantalon chino": "chino pants", "pantalon chino homme": "men's chino pants",
  // chemise
  "chemise": "shirt", "chemise femme": "women shirt", "chemise homme": "men shirt",
  // blouse
  "blouse": "blouse", "blouse femme": "women blouse",
  // manteau / veste
  "manteau": "coat", "manteau femme": "women coat", "manteau homme": "men coat",
  "veste": "jacket", "veste femme": "women jacket", "veste homme": "men jacket",
  // pull
  "pull": "sweater", "pull femme": "women sweater", "pull homme": "men sweater",
  // baskets / bottes / sandales / talons
  "basket": "sneakers", "basket femme": "women sneakers", "basket homme": "men sneakers",
  "botte": "boots", "botte femme": "women boots", "botte homme": "men boots",
  "sandale": "sandals", "sandale femme": "women sandals", "sandale homme": "men sandals",
  "talon": "high heels", "talon femme": "women high heels",
  "haut talon": "high heels", "talon haut": "high heels",
  "talons hauts": "high heels", "talons": "high heels",
  "chaussure talon": "heel shoes", "chaussure haut talon": "high heel shoes",
  "chaussure dame haut talon": "women high heel shoes",
  "chaussure femme talon": "women heel shoes",
  // sac (expanded)
  "sac": "bag", "sac femme": "women bag", "sac dame": "women bag",
  "sac dames": "women bag", "sac homme": "men bag", "sacoche": "messenger bag",
  "sac main": "handbag", "sac a main": "handbag", "sac bandouliere": "crossbody bag",
  // accessories
  "ceinture": "belt", "chapeau": "hat", "perruque": "wig",
  "costume": "suit", "costume homme": "men suit",
};

const HOME_GARDEN_PHRASES: Record<string, string> = {
  "frigo": "refrigerator", "refrigerateur": "refrigerator",
  "frigo grande capacite": "large refrigerator",
  "congelateur": "freezer", "micro onde": "microwave", "microonde": "microwave",
  "cuisiniere": "stove", "blender": "blender", "mixeur": "blender",
  "machine laver": "washing machine", "machine lave": "washing machine",
  "machine a lave": "washing machine", "lave linge": "washing machine",
  "climatiseur": "air conditioner", "panneau solaire": "solar panel",
  "generateur": "generator", "groupe electrogene": "generator",
  "ventilateur": "fan", "aspirateur": "vacuum cleaner",
  "fer repasser": "iron", "cafetiere": "coffee maker",
  "four": "oven", "seche cheveux": "hair dryer",
};

const GAMING_PHRASES: Record<string, string> = {
  "manette": "controller", "manette ps5": "ps5 controller", "manette ps4": "ps4 controller",
  "manette xbox": "xbox controller", "manette nintendo": "nintendo controller",
  "console": "gaming console", "jeu": "game", "jeu video": "video game",
};

const VEHICLE_PHRASES: Record<string, string> = {
  "voiture": "car", "vehicule": "vehicle", "camion": "truck",
  "moto": "motorcycle", "motocyclette": "motorcycle",
  "voiture occasion": "used car", "piece auto": "auto parts",
};

const ELECTRONICS_PHRASES: Record<string, string> = {
  "casque": "headphones", "ecouteur": "earbuds", "enceinte": "speaker",
  "clavier": "keyboard", "souris": "mouse", "imprimante": "printer",
  "tablette": "tablet", "projecteur": "projector", "moniteur": "monitor",
  "disque dur": "hard drive", "routeur": "router", "webcam": "webcam",
  "ordinateur": "laptop computer", "ordinateur portable": "laptop",
  "ordinateur hp": "hp laptop", "ordinateur hp portable": "hp laptop",
  "ordinateur dell": "dell laptop", "ordinateur lenovo": "lenovo laptop",
  "ordinateur asus": "asus laptop", "ordinateur acer": "acer laptop",
  "ordinateur bureau": "desktop computer",
};

const JEWELRY_PHRASES: Record<string, string> = {
  "montre": "watch", "montre femme": "women watch", "montre homme": "men watch",
  "bijou": "jewelry", "bague": "ring", "collier": "necklace",
  "bracelet": "bracelet", "boucle oreille": "earrings",
};

const TOYS_PHRASES: Record<string, string> = {
  "jouet": "toy", "poupee": "doll", "peluche": "plush toy", "puzzle": "puzzle",
};

const SPORTS_PHRASES: Record<string, string> = {
  "velo": "bicycle", "trottinette": "scooter", "haltere": "dumbbell",
};

const REFURBISHED_PHRASES: Record<string, string> = {
  "reconditionne": "refurbished", "occasion": "used",
};

const PARTS_PHRASES: Record<string, string> = {
  "chargeur": "charger", "coque": "phone case", "cable": "cable",
  "power bank": "power bank", "batterie": "battery",
  "protection ecran": "screen protector", "adaptateur": "adapter",
  "housse": "case", "etui": "case",
};

// ─── Token detection sets (for fallback when no phrase matches) ──────────────

const PHONE_BRANDS = new Set([
  "iphone", "samsung", "galaxy", "infinix", "tecno", "itel", "xiaomi", "redmi",
  "oneplus", "oppo", "vivo", "huawei", "google pixel", "pixel", "realme", "poco",
  "motorola", "nokia",
]);

const VEHICLE_BRANDS = new Set([
  "toyota", "bmw", "ford", "honda", "nissan", "mercedes", "hyundai", "kia",
  "chevrolet", "jeep", "lexus", "audi", "volkswagen", "mazda", "subaru",
  "mitsubishi", "suzuki", "land rover", "range rover", "peugeot", "renault",
]);

const GAMING_TOKENS = new Set([
  "ps5", "ps4", "playstation", "xbox", "nintendo", "switch", "gaming",
]);

const ELECTRONICS_TOKENS = new Set([
  "tv", "television", "smart tv", "laptop", "macbook", "pc", "ipad",
  "airpods", "camera", "ordinateur",
]);

// ─── Category definition with phrase map + token set ────────────────────────

interface CategoryDef {
  key: InferredCategory;
  phrases: Record<string, string>;
  tokens?: Set<string>;    // brand/model tokens that infer category (keep query as-is)
  keepQuery?: boolean;      // if true, use normalized tokens as query instead of phrase map
}

const CATEGORY_DEFS: CategoryDef[] = [
  // Priority order: phones first (brand detection), then specifics, clothing last
  { key: "phones", phrases: {}, tokens: PHONE_BRANDS, keepQuery: true },
  { key: "vehicles", phrases: VEHICLE_PHRASES, tokens: VEHICLE_BRANDS, keepQuery: true },
  { key: "gaming", phrases: GAMING_PHRASES, tokens: GAMING_TOKENS },
  { key: "electronics", phrases: ELECTRONICS_PHRASES, tokens: ELECTRONICS_TOKENS, keepQuery: true },
  { key: "home_garden", phrases: HOME_GARDEN_PHRASES },
  { key: "jewelry_watches", phrases: JEWELRY_PHRASES },
  { key: "toys", phrases: TOYS_PHRASES },
  { key: "sporting_goods", phrases: SPORTS_PHRASES },
  { key: "refurbished", phrases: REFURBISHED_PHRASES },
  { key: "parts_accessories", phrases: PARTS_PHRASES },
  { key: "clothing", phrases: CLOTHING_PHRASES },
];

// Build a map from category key to definition for priority lookup
const CATEGORY_BY_KEY = new Map<string, CategoryDef>();
for (const def of CATEGORY_DEFS) {
  if (def.key) CATEGORY_BY_KEY.set(def.key, def);
}

// ─── Phrase matching helper ─────────────────────────────────────────────────

function tryPhraseMatch(
  phrases: Record<string, string>,
  joined: string,
  depluralJoined: string,
): string | null {
  // Sort by key length desc so multi-word phrases match first
  const sorted = Object.keys(phrases).sort((a, b) => b.length - a.length);
  for (const phrase of sorted) {
    if (joined === phrase || depluralJoined === phrase) return phrases[phrase];
    if (joined.includes(phrase) || depluralJoined.includes(phrase)) return phrases[phrase];
  }
  return null;
}

function tryTokenMatch(tokens: Set<string> | undefined, joined: string): string | null {
  if (!tokens) return null;
  for (const t of tokens) {
    if (joined.includes(t)) return t;
  }
  return null;
}

// ─── Main pre-normalizer ────────────────────────────────────────────────────

export function preNormalizeQuery(
  qRaw: string,
  requestCategoryKey?: string | null,
): PreNormalizeResult {
  const norm = normalize(qRaw);
  const tokens = stripStops(norm.split(/\s+/));
  const depluralTokens = tokens.map(depluralize);
  const joined = tokens.join(" ");
  const depluralJoined = depluralTokens.join(" ");

  const noMatch: PreNormalizeResult = {
    effectiveQuery: qRaw.trim(),
    inferredCategory: null,
    skipAI: false,
    matched: false,
    qNormalizedNoStops: joined,
  };

  if (tokens.length === 0) return noMatch;

  // ─── Build search order: prioritize request's category_key if provided ────
  let orderedDefs = CATEGORY_DEFS;
  if (requestCategoryKey) {
    const priorityDef = CATEGORY_BY_KEY.get(requestCategoryKey);
    if (priorityDef) {
      orderedDefs = [priorityDef, ...CATEGORY_DEFS.filter(d => d.key !== requestCategoryKey)];
    }
  }

  // ─── Try each category ────────────────────────────────────────────────────
  for (const def of orderedDefs) {
    // 1. Try phrase map match
    const phraseMatch = tryPhraseMatch(def.phrases, joined, depluralJoined);
    if (phraseMatch) {
      return {
        effectiveQuery: phraseMatch,
        inferredCategory: def.key,
        skipAI: true,
        matched: true,
        matchRule: `${def.key}:phrase:${phraseMatch}`,
        qNormalizedNoStops: joined,
      };
    }

    // 2. Try token/brand match (keep original query for model numbers)
    const tokenMatch = tryTokenMatch(def.tokens, joined);
    if (tokenMatch) {
      // For token matches, translate any remaining FR words in the query
      let eq = joined;
      // Apply category-specific phrase translations to remaining tokens
      for (const [fr, en] of Object.entries(def.phrases)) {
        if (eq.includes(fr)) {
          eq = eq.replace(fr, en);
        }
      }
      return {
        effectiveQuery: def.keepQuery ? tokens.join(" ") : eq,
        inferredCategory: def.key,
        skipAI: true,
        matched: true,
        matchRule: `${def.key}:token:${tokenMatch}`,
        qNormalizedNoStops: joined,
      };
    }
  }

  return noMatch;
}
