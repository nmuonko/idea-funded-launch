/**
 * Dynamic Query Normalizer — Entity-preserving token-level FR→EN normalization
 * 
 * Runs AFTER the static map layer. Only normalizes unresolved French tokens
 * while preserving brands, models, and product codes.
 * 
 * Strategy:
 *  1. Classify each token (brand/model vs French vs unknown)
 *  2. Translate only French tokens using a comprehensive token-level map
 *  3. Reassemble query preserving entity order
 *  4. Cache results for 14 days
 * 
 * This is the "Step 2b" in the pipeline, between static map and OpenAI fallback.
 */

import { detectQueryLanguage, isProtectedEntity, type LanguageDetectionResult } from "./languageDetector.ts";
import { FR_EN_MAP } from "./frenchEnglishMap.ts";
import { createAdminPostgrestClient } from "./postgrest.ts";

// ─── TOKEN-LEVEL TRANSLATION MAP ────────────────────────────────────────────
// Maps individual French tokens to English equivalents.
// This is different from FR_EN_MAP which maps full phrases.
const FR_TOKEN_MAP: Record<string, string> = {
  // Product descriptors
  "pliable": "foldable",
  "occasion": "used",
  "neuf": "new",
  "neuve": "new",
  "reconditionne": "refurbished",
  "cher": "expensive",
  "marche": "market",
  "qualite": "quality",
  "rapide": "fast",
  "puissant": "powerful",
  "puissante": "powerful",
  "silencieux": "quiet",
  "etanche": "waterproof",
  "resistant": "resistant",
  "solide": "sturdy",
  "durable": "durable",
  "economique": "budget",
  "professionnel": "professional",
  "automatique": "automatic",
  "leger": "lightweight",
  "legere": "lightweight",
  "lourd": "heavy",
  "lourde": "heavy",
  // Commerce
  "prix": "price",
  "promo": "sale",
  "promotion": "sale",
  "solde": "clearance",
  "gratuit": "free",
  "livraison": "shipping",
  "garantie": "warranty",
  "authentique": "genuine",
  "original": "original",
  // Product types
  "telephone": "phone",
  "portable": "laptop",
  "ordinateur": "computer",
  "tablette": "tablet",
  "montre": "watch",
  "casque": "headphones",
  "ecouteur": "earbuds",
  "ecouteurs": "earbuds",
  "enceinte": "speaker",
  "chargeur": "charger",
  "coque": "case",
  "housse": "cover",
  "etui": "case",
  "cable": "cable",
  "batterie": "battery",
  "clavier": "keyboard",
  "souris": "mouse",
  "imprimante": "printer",
  "routeur": "router",
  "camera": "camera",
  "appareil": "device",
  "voiture": "car",
  "vehicule": "vehicle",
  "camion": "truck",
  "moto": "motorcycle",
  "motocyclette": "motorcycle",
  "velo": "bicycle",
  "trottinette": "scooter",
  "piece": "part",
  "pieces": "parts",
  "pneu": "tire",
  "pneus": "tires",
  "huile": "oil",
  "moteur": "engine",
  "frein": "brake",
  "phare": "headlight",
  "filtre": "filter",
  "chaussure": "shoes",
  "chaussures": "shoes",
  "robe": "dress",
  "jupe": "skirt",
  "pantalon": "pants",
  "chemise": "shirt",
  "veste": "jacket",
  "manteau": "coat",
  "pull": "sweater",
  "basket": "sneakers",
  "baskets": "sneakers",
  "botte": "boots",
  "bottes": "boots",
  "sandale": "sandals",
  "sandales": "sandals",
  "talon": "heels",
  "talons": "heels",
  "sac": "bag",
  "sacoche": "messenger bag",
  "ceinture": "belt",
  "chapeau": "hat",
  "lunettes": "glasses",
  "perruque": "wig",
  "tissage": "hair weave",
  "meches": "hair extensions",
  "bijou": "jewelry",
  "bijoux": "jewelry",
  "bague": "ring",
  "collier": "necklace",
  "bracelet": "bracelet",
  "frigo": "refrigerator",
  "frigidaire": "refrigerator",
  "refrigerateur": "refrigerator",
  "congelateur": "freezer",
  "cuisiniere": "stove",
  "four": "oven",
  "mixeur": "blender",
  "aspirateur": "vacuum",
  "ventilateur": "fan",
  "climatiseur": "air conditioner",
  "machine": "machine",
  "laver": "washing",
  "cafetiere": "coffee maker",
  "bouilloire": "kettle",
  "generateur": "generator",
  "panneau": "panel",
  "solaire": "solar",
  "pompe": "pump",
  "eau": "water",
  "perceuse": "drill",
  "scie": "saw",
  "tondeuse": "mower",
  "tronconneuse": "chainsaw",
  "jouet": "toy",
  "jouets": "toys",
  "jeu": "game",
  "jeux": "games",
  "matelas": "mattress",
  "canape": "sofa",
  "etagere": "shelf",
  "armoire": "wardrobe",
  "table": "table",
  "chaise": "chair",
  "lampe": "lamp",
  "rideau": "curtain",
  "rideaux": "curtains",
  "coussin": "cushion",
  "tapis": "rug",
  "creme": "cream",
  "savon": "soap",
  "shampoing": "shampoo",
  "shampooing": "shampoo",
  "maquillage": "makeup",
  "parfum": "perfume",
  "lotion": "lotion",
  "serum": "serum",
  "masque": "mask",
  "beurre": "butter",
  "karite": "shea",
  "deodorant": "deodorant",
  "vernis": "nail polish",
  "couche": "diaper",
  "biberon": "bottle",
  "poussette": "stroller",
  "moustiquaire": "mosquito net",
  "drap": "sheet",
  "draps": "sheets",
  // Gender/target
  "homme": "men",
  "femme": "women",
  "dame": "women",
  "dames": "women",
  "enfant": "kids",
  "enfants": "kids",
  "bebe": "baby",
  "fille": "girls",
  "garcon": "boys",
  // Colors
  "noir": "black",
  "blanc": "white",
  "blanche": "white",
  "rouge": "red",
  "bleu": "blue",
  "bleue": "blue",
  "vert": "green",
  "verte": "green",
  "jaune": "yellow",
  "rose": "pink",
  "violet": "purple",
  "gris": "gray",
  "marron": "brown",
  "dore": "gold",
  "argente": "silver",
  // Sizes
  "grand": "large",
  "grande": "large",
  "petit": "small",
  "petite": "small",
  "moyen": "medium",
  "moyenne": "medium",
  "double": "double",
  "triple": "triple",
  "porte": "door",
  "portes": "doors",
  "feux": "burner",
  // Intent descriptors
  "course": "running",
  "courses": "running",
  "sport": "sport",
  "sportif": "sports",
  "classique": "classic",
  "moderne": "modern",
  "vintage": "vintage",
  "luxe": "luxury",
  "elegante": "elegant",
  "elegant": "elegant",
  "gamer": "gaming",
  "etudiant": "student",
  "scolaire": "school",
  "maison": "home",
  "cuisine": "kitchen",
  "jardin": "garden",
  "exterieur": "outdoor",
  "interieur": "indoor",
  "camping": "camping",
  "voyage": "travel",
  "plage": "beach",
  // Fuel / power
  "diesel": "diesel",
  "essence": "gasoline",
  "electrique": "electric",
  "hybride": "hybrid",
};

// ─── PHRASE PATTERNS (2-3 word FR idioms) ───────────────────────────────────
// Checked before token-level to handle idiomatic expressions
const FR_PHRASE_PATTERNS: [string, string][] = [
  ["pas cher", "affordable"],
  ["bon marche", "budget"],
  ["bon prix", "good price"],
  ["haut gamme", "premium"],
  ["haute gamme", "premium"],
  ["bas prix", "low price"],
  ["meilleur prix", "best price"],
  ["double porte", "french door"],
  ["double portes", "french door"],
  ["quatre feux", "4 burner"],
  ["4 feux", "4 burner"],
  ["machine laver", "washing machine"],
  ["machine lave", "washing machine"],
  ["a laver", "washing"],
  ["de course", "running"],
  ["de sport", "sports"],
  ["de luxe", "luxury"],
  ["haut talon", "high heel"],
  ["talons hauts", "high heels"],
  ["sac main", "handbag"],
  ["sac a main", "handbag"],
  ["ecran plat", "flat screen"],
  ["grand ecran", "large screen"],
  ["tout terrain", "all terrain"],
  ["quatre roues", "four wheel"],
  ["4 roues", "4 wheel"],
  // Sort by length descending for greedy matching
].sort((a, b) => b[0].length - a[0].length);

export interface DynamicNormalizationResult {
  /** The normalized English query */
  normalizedQuery: string;
  /** Whether any normalization was applied */
  wasNormalized: boolean;
  /** Tokens that were translated */
  translatedTokens: { from: string; to: string }[];
  /** Protected entities preserved */
  preservedEntities: string[];
  /** Whether result came from cache */
  fromCache: boolean;
  /** Language detection result */
  langDetection: LanguageDetectionResult;
}

/**
 * Normalize a search query by translating French tokens to English
 * while preserving brands, models, and product codes.
 * 
 * @param query Raw or partially-normalized query
 * @param requestId For logging
 * @param skipCache If true, bypass cache lookup (e.g. on manual retry)
 */
export async function dynamicNormalizeQuery(
  query: string,
  requestId: string,
  skipCache = false,
): Promise<DynamicNormalizationResult> {
  const langDetection = detectQueryLanguage(query);
  
  // Fast exit if no French signal
  if (!langDetection.hasFrenchSignal) {
    return {
      normalizedQuery: query,
      wasNormalized: false,
      translatedTokens: [],
      preservedEntities: langDetection.protectedEntities,
      fromCache: false,
      langDetection,
    };
  }

  // Check dynamic normalization cache (query_translation_cache with provider=dynamic)
  const normalized = query.toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/['`]/g, " ")
    .replace(/[-_]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!skipCache) {
    try {
      const client = createAdminPostgrestClient();
      const { data } = await client
        .from("query_translation_cache")
        .select("translated_query")
        .eq("source_lang", "auto")
        .eq("target_lang", "en")
        .eq("normalized_query", normalized)
        .eq("provider", "dynamic")
        .gt("expires_at", new Date().toISOString())
        .limit(1)
        .execute();

      if (data && Array.isArray(data) && data.length > 0) {
        console.log(`[DYNAMIC_NORM] requestId=${requestId} CACHE_HIT: "${query}" → "${data[0].translated_query}"`);
        return {
          normalizedQuery: data[0].translated_query,
          wasNormalized: true,
          translatedTokens: [],
          preservedEntities: langDetection.protectedEntities,
          fromCache: true,
          langDetection,
        };
      }
    } catch (e) {
      console.warn(`[DYNAMIC_NORM] requestId=${requestId} cache error:`, (e as Error).message);
    }
  }

  // ─── PHRASE-LEVEL NORMALIZATION FIRST ────────────────────────────────────
  let working = normalized;
  const translatedTokens: { from: string; to: string }[] = [];

  for (const [frPhrase, enPhrase] of FR_PHRASE_PATTERNS) {
    if (working.includes(frPhrase)) {
      working = working.replace(frPhrase, enPhrase);
      translatedTokens.push({ from: frPhrase, to: enPhrase });
    }
  }

  // ─── TOKEN-LEVEL NORMALIZATION ──────────────────────────────────────────
  // Remove French stop words, then translate individual tokens
  const FR_STOPS = new Set(["pour", "de", "du", "des", "le", "la", "les", "un", "une", "en", "a", "et", "ou", "avec", "sans"]);
  
  const tokens = working.split(/\s+/);
  const resultTokens: string[] = [];

  for (const token of tokens) {
    if (FR_STOPS.has(token) && tokens.length > 1) {
      // Skip stop words in multi-word queries
      continue;
    }

    if (isProtectedEntity(token)) {
      resultTokens.push(token);
      continue;
    }

    // Try token-level map
    const translation = FR_TOKEN_MAP[token];
    if (translation) {
      resultTokens.push(translation);
      translatedTokens.push({ from: token, to: translation });
    } else {
      // Try FR_EN_MAP for single tokens
      const mapTranslation = FR_EN_MAP[token];
      if (mapTranslation) {
        resultTokens.push(mapTranslation);
        translatedTokens.push({ from: token, to: mapTranslation });
      } else {
        // Keep as-is (might be English or unknown)
        resultTokens.push(token);
      }
    }
  }

  const result = resultTokens.join(" ").replace(/\s+/g, " ").trim();
  const wasNormalized = result !== normalized && translatedTokens.length > 0;

  if (wasNormalized) {
    console.log(`[DYNAMIC_NORM] requestId=${requestId} normalized: "${query}" → "${result}" (${translatedTokens.length} tokens translated)`);

    // Cache the result (fire-and-forget)
    const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
    try {
      const client = createAdminPostgrestClient();
      client
        .from("query_translation_cache")
        .upsert({
          source_lang: "auto",
          target_lang: "en",
          normalized_query: normalized,
          translated_query: result,
          provider: "dynamic",
          hit_count: 0,
          expires_at: expiresAt,
        }, { onConflict: "source_lang,target_lang,normalized_query" })
        .execute()
        .catch(() => {});
    } catch {}
  }

  return {
    normalizedQuery: wasNormalized ? result : query,
    wasNormalized,
    translatedTokens,
    preservedEntities: langDetection.protectedEntities,
    fromCache: false,
    langDetection,
  };
}
