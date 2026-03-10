/**
 * Language Detector — Token-level French detection for mixed-language queries
 * 
 * Unlike the old approach (accent-only), this detects French tokens even in
 * mixed French-English queries with no accents, e.g. "galaxy pliable",
 * "iphone pas cher", "chaussure nike homme".
 * 
 * Strategy:
 *  1. Check for accented characters (fast path)
 *  2. Check each token against a French-word corpus (~200 common e-commerce terms)
 *  3. Exclude known brands/models/product codes from language scoring
 *  4. Return per-token language classification + overall confidence
 */

// ─── PROTECTED ENTITIES ─────────────────────────────────────────────────────
// These tokens are brands, models, or product codes that should NEVER be translated.
const PROTECTED_ENTITIES = new Set([
  // Phone brands & models
  "iphone", "samsung", "galaxy", "infinix", "tecno", "itel", "xiaomi", "redmi",
  "oneplus", "oppo", "vivo", "huawei", "pixel", "realme", "poco", "motorola",
  "nokia", "honor", "nothing", "fairphone", "zte",
  // Phone model lines
  "pro", "max", "ultra", "plus", "lite", "mini", "se", "note", "fold", "flip",
  "camon", "spark", "hot", "gt",
  // Computer brands
  "macbook", "imac", "dell", "hp", "lenovo", "thinkpad", "asus", "acer", "msi",
  "razer", "alienware", "surface", "chromebook",
  // Gaming
  "playstation", "ps5", "ps4", "ps3", "xbox", "nintendo", "switch", "steam",
  // Audio
  "airpods", "bose", "jbl", "beats", "sennheiser", "jabra", "marshall", "sonos",
  // Fashion brands
  "nike", "adidas", "puma", "reebok", "jordan", "converse", "vans", "gucci",
  "louis", "vuitton", "prada", "versace", "zara", "levis", "timberland",
  "balenciaga", "dior", "chanel", "hermes", "fendi",
  // Vehicle brands
  "toyota", "bmw", "ford", "honda", "nissan", "mercedes", "hyundai", "kia",
  "chevrolet", "jeep", "lexus", "audi", "volkswagen", "mazda", "subaru",
  "peugeot", "renault", "mitsubishi", "suzuki", "corolla", "camry", "civic",
  "rav4", "hilux", "fortuner", "tacoma", "mustang", "bronco", "wrangler",
  // Appliance brands
  "dyson", "bosch", "makita", "dewalt", "karcher", "lg", "sony", "hisense",
  "gopro", "garmin", "canon", "nikon", "fitbit",
  // Generic model identifiers (numbers, alphanumeric codes)
  "5g", "4g", "lte", "wifi", "usb", "hdmi", "led", "oled", "qled", "lcd",
]);

// Pattern for model numbers like "15", "14 pro", "s24", "a54", "3080", etc.
const MODEL_NUMBER_RE = /^[a-z]?\d{1,4}[a-z]?$/i;

export function isProtectedEntity(token: string): boolean {
  const t = token.toLowerCase();
  if (PROTECTED_ENTITIES.has(t)) return true;
  if (MODEL_NUMBER_RE.test(t)) return true;
  // Pure numbers
  if (/^\d+$/.test(t)) return true;
  return false;
}

// ─── FRENCH TOKEN CORPUS ────────────────────────────────────────────────────
// Common French e-commerce words (no accents needed — we normalize before matching)
const FRENCH_TOKENS = new Set([
  // Product descriptors
  "pliable", "occasion", "neuf", "neuve", "reconditionne", "usagé", "usage",
  "pas", "cher", "moins", "bon", "marche", "meilleur", "qualite", "qualité",
  "grande", "petit", "petite", "gros", "grosse", "leger", "legere", "lourd",
  "lourde", "rapide", "lent", "puissant", "puissante", "silencieux", "etanche",
  "resistant", "solide", "durable", "economique", "professionnel", "automatique",
  // Commerce
  "prix", "promo", "promotion", "solde", "soldes", "remise", "gratuit", "livraison",
  "garantie", "original", "authentique", "copie", "faux", "lot", "pack", "coffret",
  // Product types
  "telephone", "portable", "ordinateur", "tablette", "montre", "casque", "ecouteur",
  "ecouteurs", "enceinte", "chargeur", "coque", "housse", "etui", "cable",
  "batterie", "clavier", "souris", "imprimante", "routeur", "camera", "appareil",
  "voiture", "vehicule", "camion", "moto", "motocyclette", "velo", "trottinette",
  "piece", "pieces", "pneu", "pneus", "huile", "moteur", "frein", "phare",
  "pare", "choc", "brise", "filtre",
  "chaussure", "chaussures", "robe", "jupe", "pantalon", "chemise", "veste",
  "manteau", "pull", "basket", "baskets", "botte", "bottes", "sandale", "sandales",
  "talon", "talons", "sac", "sacoche", "ceinture", "chapeau", "lunettes",
  "perruque", "tissage", "meches", "bijou", "bijoux", "bague", "collier",
  "bracelet", "boucle", "oreille", "oreilles", "montre",
  "frigo", "frigidaire", "refrigerateur", "congelateur", "cuisiniere", "four",
  "micro", "onde", "ondes", "mixeur", "blender", "aspirateur", "ventilateur",
  "climatiseur", "machine", "laver", "seche", "cheveux", "fer", "repasser",
  "cafetiere", "bouilloire",
  "generateur", "groupe", "electrogene", "panneau", "solaire", "pompe", "eau",
  "perceuse", "scie", "tondeuse", "tronconneuse", "broyeur", "pulverisateur",
  "jouet", "jouets", "poupee", "peluche", "puzzle", "jeu", "jeux",
  "matelas", "canape", "bureau", "etagere", "lit", "armoire", "table",
  "chaise", "lampe", "rideau", "rideaux", "coussin", "tapis",
  "creme", "savon", "shampoing", "shampooing", "maquillage", "parfum",
  "lotion", "serum", "masque", "huile", "beurre", "karite", "deodorant",
  "vernis", "rouge", "levre", "levres", "fond", "teint",
  "couche", "biberon", "lait", "infantile", "poussette", "berceau",
  "moustiquaire", "drap", "draps",
  // Gender / target
  "homme", "femme", "dame", "dames", "enfant", "enfants", "bebe", "fille",
  "garcon", "adulte", "mixte", "unisexe",
  // Colors (FR)
  "noir", "blanc", "blanche", "rouge", "bleu", "bleue", "vert", "verte",
  "jaune", "rose", "violet", "violette", "orange", "gris", "grise",
  "marron", "beige", "dore", "argente",
  // Sizes / quantities
  "grand", "grande", "petit", "petite", "moyen", "moyenne", "taille",
  "double", "triple", "porte", "portes", "feux", "places",
  // Context words (strong FR signal even in mixed queries)
  "pour", "avec", "sans", "dans", "sur", "sous", "entre", "tres", "très",
  "plus", "aussi", "comme", "tout", "toute", "tous", "toutes",
  "nouveau", "nouvelle", "nouveaux", "dernier", "derniere", "dernière",
  "meilleur", "meilleure", "bon", "bonne", "mauvais", "mauvaise",
  // Intent words
  "acheter", "achat", "vente", "cherche", "recherche", "besoin", "trouver",
  "comparer", "commande", "commander", "course", "courses", "elegante",
  "elegant", "sport", "sportif", "classique", "moderne", "vintage", "luxe",
  // Descriptors that signal FR intent
  "diesel", "essence", "electrique", "hybride", "gamer", "gaming",
  "etudiant", "scolaire", "bureau", "maison", "cuisine", "jardin",
  "exterieur", "interieur", "camping", "voyage", "plage",
]);

const ACCENT_RE = /[àâäéèêëïîôùûüÿçœæ]/i;

export interface TokenClassification {
  token: string;
  lang: "fr" | "en" | "brand" | "model" | "unknown";
}

export interface LanguageDetectionResult {
  /** Overall detected language */
  detectedLang: "fr" | "en" | "mixed" | "unknown";
  /** Confidence 0-1 */
  confidence: number;
  /** Per-token classification */
  tokens: TokenClassification[];
  /** French tokens found (excluding brands/models) */
  frenchTokens: string[];
  /** Protected entities found (brands, models, numbers) */
  protectedEntities: string[];
  /** Whether the query has any French signal */
  hasFrenchSignal: boolean;
}

function normalizeForDetection(s: string): string {
  return s.toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/['`]/g, " ")
    .replace(/[-_]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Detect language of a search query with entity-awareness.
 * Works for pure French, pure English, and mixed queries.
 */
export function detectQueryLanguage(query: string): LanguageDetectionResult {
  const raw = query.trim();
  const hasAccents = ACCENT_RE.test(raw);
  
  const normalized = normalizeForDetection(raw);
  const words = normalized.split(/\s+/).filter(w => w.length > 0);
  
  if (words.length === 0) {
    return { detectedLang: "unknown", confidence: 0, tokens: [], frenchTokens: [], protectedEntities: [], hasFrenchSignal: false };
  }

  const classifications: TokenClassification[] = [];
  const frenchTokens: string[] = [];
  const protectedEntities: string[] = [];

  for (const word of words) {
    if (isProtectedEntity(word)) {
      classifications.push({ token: word, lang: "brand" });
      protectedEntities.push(word);
    } else if (FRENCH_TOKENS.has(word)) {
      classifications.push({ token: word, lang: "fr" });
      frenchTokens.push(word);
    } else {
      // Check original (with accents) for accent detection
      classifications.push({ token: word, lang: "unknown" });
    }
  }

  // Accent in original query is a strong FR signal
  if (hasAccents) {
    // Reclassify unknown tokens as likely French
    for (const c of classifications) {
      if (c.lang === "unknown") {
        c.lang = "fr";
        frenchTokens.push(c.token);
      }
    }
  }

  const nonBrandTokens = classifications.filter(c => c.lang !== "brand" && c.lang !== "model");
  const frCount = nonBrandTokens.filter(c => c.lang === "fr").length;
  const totalNonBrand = nonBrandTokens.length;

  let detectedLang: "fr" | "en" | "mixed" | "unknown" = "unknown";
  let confidence = 0;

  if (totalNonBrand === 0) {
    // All tokens are brands/models — treat as English (brand searches)
    detectedLang = "en";
    confidence = 0.5;
  } else if (frCount === totalNonBrand) {
    detectedLang = "fr";
    confidence = Math.min(1, 0.6 + frCount * 0.1);
  } else if (frCount > 0) {
    detectedLang = "mixed";
    confidence = Math.min(1, 0.5 + frCount * 0.15);
  } else {
    detectedLang = hasAccents ? "fr" : "unknown";
    confidence = hasAccents ? 0.7 : 0.2;
  }

  return {
    detectedLang,
    confidence,
    tokens: classifications,
    frenchTokens,
    protectedEntities,
    hasFrenchSignal: frCount > 0 || hasAccents,
  };
}
