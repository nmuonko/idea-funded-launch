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

export type InferredCategory =
  | "clothing" | "phones" | "electronics" | "vehicles" | "gaming"
  | "home_garden" | "toys" | "sporting_goods" | "jewelry_watches"
  | "refurbished" | "parts_accessories" | null;

export interface PreNormalizeResult {
  effectiveQuery: string;
  inferredCategory: InferredCategory;
  skipAI: boolean;
  matched: boolean;       // true if any rule triggered
  matchRule?: string;      // debug: which rule matched
}

// ─── Token sets per category ────────────────────────────────────────────────

// Clothing core tokens (FR → EN mappings done inline)
const CLOTHING_FR: Record<string, string> = {
  "jupe": "skirt", "jupes": "skirt",
  "robe": "dress", "robes": "dress",
  "chemise": "shirt", "chemises": "shirt",
  "blouse": "blouse", "blouses": "blouse",
  "pantalon": "pants", "pantalons": "pants",
  "vetement": "clothing", "vetements": "clothing", "vêtement": "clothing", "vêtements": "clothing",
  "chaussure": "shoes", "chaussures": "shoes",
  "baskets": "sneakers", "basket": "sneakers",
  "bottes": "boots", "botte": "boots",
  "sandales": "sandals", "sandale": "sandals",
  "talons": "heels", "talon": "heels",
  "manteau": "coat", "manteaux": "coat",
  "veste": "jacket", "vestes": "jacket",
  "pull": "sweater", "pulls": "sweater",
  "sac": "bag", "sacs": "bag",
  "sacoche": "messenger bag",
  "ceinture": "belt", "chapeau": "hat",
  "perruque": "wig", "perruques": "wig",
  "costume": "suit", "costumes": "suit",
};
const GENDER_FR: Record<string, string> = {
  "femme": "women", "femmes": "women",
  "dame": "women", "dames": "women",
  "homme": "men", "hommes": "men",
  "enfant": "kids", "enfants": "kids",
  "fille": "girls", "filles": "girls",
  "garcon": "boys", "garcons": "boys",
  "bebe": "baby", "bébé": "baby",
};

const PHONE_BRANDS = new Set([
  "iphone", "samsung", "galaxy", "infinix", "tecno", "itel", "xiaomi", "redmi",
  "oneplus", "oppo", "vivo", "huawei", "google pixel", "pixel", "realme", "poco",
  "motorola", "nokia",
]);

const ELECTRONICS_TOKENS = new Set([
  "tv", "television", "smart tv", "laptop", "macbook", "pc", "tablette", "tablet",
  "ipad", "casque", "headphones", "ecouteurs", "écouteurs", "airpods", "camera",
  "projecteur", "projector", "imprimante", "printer", "enceinte", "speaker",
  "clavier", "keyboard", "souris", "mouse", "moniteur", "monitor", "webcam",
  "disque dur", "hard drive", "ssd", "usb", "routeur", "router",
]);

const VEHICLE_BRANDS = new Set([
  "toyota", "bmw", "ford", "honda", "nissan", "mercedes", "hyundai", "kia",
  "chevrolet", "jeep", "lexus", "audi", "volkswagen", "mazda", "subaru",
  "mitsubishi", "suzuki", "land rover", "range rover", "peugeot", "renault",
]);
const VEHICLE_TOKENS = new Set([
  "voiture", "voitures", "vehicule", "véhicule", "vehicules", "suv",
  "camion", "camions", "truck", "moto", "motorcycle", "motocyclette",
  "car", "sedan", "pickup",
]);

const GAMING_TOKENS = new Set([
  "ps5", "ps4", "playstation", "xbox", "nintendo", "switch",
  "manette", "controller", "console", "game", "jeu", "jeux",
  "gaming",
]);

const HOME_GARDEN_TOKENS = new Set([
  "frigo", "refrigerateur", "réfrigérateur", "congelateur", "congélateur",
  "micro onde", "micro-onde", "microwave", "cuisiniere", "cuisinière",
  "blender", "mixeur", "machine a laver", "washing machine", "lave linge",
  "climatiseur", "air conditioner", "panneau solaire", "solar panel",
  "generateur", "générateur", "groupe electrogene", "groupe électrogène",
  "ventilateur", "fan", "aspirateur", "vacuum", "fer a repasser",
  "cafetiere", "cafetière", "four", "oven", "seche cheveux",
]);

const TOYS_TOKENS = new Set([
  "jouet", "jouets", "lego", "poupee", "poupée", "doll", "toy", "toys",
  "peluche", "puzzle",
]);

const SPORTS_TOKENS = new Set([
  "sport", "fitness", "treadmill", "velo", "vélo", "bicycle",
  "ball", "dumbbell", "haltere", "haltère", "yoga", "gym",
  "trottinette", "scooter",
]);

const JEWELRY_TOKENS = new Set([
  "montre", "montres", "watch", "watches", "bijoux", "jewelry",
  "bague", "ring", "collier", "necklace", "bracelet", "boucles",
  "earrings",
]);

const REFURBISHED_TOKENS = new Set([
  "reconditionne", "reconditionné", "refurbished", "used like new",
  "renewed", "occasion",
]);

const PARTS_TOKENS = new Set([
  "accessoire", "accessoires", "chargeur", "charger", "coque", "case",
  "cable", "câble", "power bank", "batterie", "battery",
  "protection ecran", "protection écran", "screen protector",
  "adaptateur", "adapter", "support", "housse", "etui", "étui",
]);

// ─── Main pre-normalizer ────────────────────────────────────────────────────

export function preNormalizeQuery(qRaw: string): PreNormalizeResult {
  const norm = normalize(qRaw);
  const tokens = stripStops(norm.split(/\s+/));
  const joined = tokens.join(" ");

  // Default: no match
  const noMatch: PreNormalizeResult = {
    effectiveQuery: qRaw.trim(),
    inferredCategory: null,
    skipAI: false,
    matched: false,
  };

  if (tokens.length === 0) return noMatch;

  // ─── 1. CLOTHING (most common failing case) ─────────────────────────────
  {
    let clothingItem: string | null = null;
    let gender: string | null = null;
    const normTokens = tokens.map(t => normalize(t));

    for (const t of normTokens) {
      if (CLOTHING_FR[t] && !gender) clothingItem = CLOTHING_FR[t];
      if (GENDER_FR[t]) gender = GENDER_FR[t];
    }
    // Also check 2-token compounds
    for (let i = 0; i < normTokens.length - 1; i++) {
      const pair = normTokens[i] + " " + normTokens[i + 1];
      if (CLOTHING_FR[pair]) clothingItem = CLOTHING_FR[pair];
    }

    if (clothingItem) {
      const effectiveQuery = gender
        ? `${gender} ${clothingItem}`
        : clothingItem;
      return {
        effectiveQuery,
        inferredCategory: "clothing",
        skipAI: true,
        matched: true,
        matchRule: `clothing:${clothingItem}${gender ? "+" + gender : ""}`,
      };
    }
  }

  // ─── 2. PHONES (brand + model) ──────────────────────────────────────────
  {
    for (const brand of PHONE_BRANDS) {
      if (joined.includes(brand)) {
        // Keep original tokens — model numbers are important
        return {
          effectiveQuery: tokens.join(" "),
          inferredCategory: "phones",
          skipAI: true,
          matched: true,
          matchRule: `phones:${brand}`,
        };
      }
    }
  }

  // ─── 3. VEHICLES (brand/type + model) ───────────────────────────────────
  {
    for (const brand of VEHICLE_BRANDS) {
      if (joined.includes(brand)) {
        return {
          effectiveQuery: tokens.join(" "),
          inferredCategory: "vehicles",
          skipAI: true,
          matched: true,
          matchRule: `vehicles:${brand}`,
        };
      }
    }
    for (const vt of VEHICLE_TOKENS) {
      if (joined.includes(vt)) {
        // Translate FR vehicle token
        const enMap: Record<string, string> = {
          "voiture": "car", "voitures": "cars", "vehicule": "vehicle",
          "véhicule": "vehicle", "vehicules": "vehicles",
          "camion": "truck", "camions": "trucks", "moto": "motorcycle",
          "motocyclette": "motorcycle",
        };
        let eq = joined;
        for (const [fr, en] of Object.entries(enMap)) {
          eq = eq.replace(new RegExp(`\\b${fr}\\b`, "g"), en);
        }
        return {
          effectiveQuery: eq,
          inferredCategory: "vehicles",
          skipAI: true,
          matched: true,
          matchRule: `vehicles:${vt}`,
        };
      }
    }
  }

  // ─── 4. GAMING ──────────────────────────────────────────────────────────
  {
    for (const gt of GAMING_TOKENS) {
      if (joined.includes(gt)) {
        const enMap: Record<string, string> = {
          "manette": "controller", "jeu": "game", "jeux": "games",
        };
        let eq = joined;
        for (const [fr, en] of Object.entries(enMap)) {
          eq = eq.replace(new RegExp(`\\b${fr}\\b`, "g"), en);
        }
        return {
          effectiveQuery: eq,
          inferredCategory: "gaming",
          skipAI: true,
          matched: true,
          matchRule: `gaming:${gt}`,
        };
      }
    }
  }

  // ─── 5. HOME & GARDEN ──────────────────────────────────────────────────
  {
    for (const ht of HOME_GARDEN_TOKENS) {
      if (joined.includes(ht)) {
        // Use the FR_EN_MAP translation if available, else keep joined
        return {
          effectiveQuery: joined, // will be translated by FR_EN_MAP layer
          inferredCategory: "home_garden",
          skipAI: true,
          matched: true,
          matchRule: `home_garden:${ht}`,
        };
      }
    }
  }

  // ─── 6. ELECTRONICS ────────────────────────────────────────────────────
  {
    for (const et of ELECTRONICS_TOKENS) {
      if (joined.includes(et)) {
        return {
          effectiveQuery: tokens.join(" "),
          inferredCategory: "electronics",
          skipAI: true,
          matched: true,
          matchRule: `electronics:${et}`,
        };
      }
    }
  }

  // ─── 7. JEWELRY / WATCHES ──────────────────────────────────────────────
  {
    for (const jt of JEWELRY_TOKENS) {
      if (joined.includes(jt)) {
        return {
          effectiveQuery: joined,
          inferredCategory: "jewelry_watches",
          skipAI: true,
          matched: true,
          matchRule: `jewelry:${jt}`,
        };
      }
    }
  }

  // ─── 8. TOYS ───────────────────────────────────────────────────────────
  {
    for (const tt of TOYS_TOKENS) {
      if (joined.includes(tt)) {
        return {
          effectiveQuery: joined,
          inferredCategory: "toys",
          skipAI: true,
          matched: true,
          matchRule: `toys:${tt}`,
        };
      }
    }
  }

  // ─── 9. SPORTING GOODS ─────────────────────────────────────────────────
  {
    for (const st of SPORTS_TOKENS) {
      if (joined.includes(st)) {
        return {
          effectiveQuery: joined,
          inferredCategory: "sporting_goods",
          skipAI: true,
          matched: true,
          matchRule: `sports:${st}`,
        };
      }
    }
  }

  // ─── 10. REFURBISHED ───────────────────────────────────────────────────
  {
    for (const rt of REFURBISHED_TOKENS) {
      if (joined.includes(rt)) {
        return {
          effectiveQuery: joined,
          inferredCategory: "refurbished",
          skipAI: true,
          matched: true,
          matchRule: `refurbished:${rt}`,
        };
      }
    }
  }

  // ─── 11. PARTS & ACCESSORIES ───────────────────────────────────────────
  {
    for (const pt of PARTS_TOKENS) {
      if (joined.includes(pt)) {
        return {
          effectiveQuery: joined,
          inferredCategory: "parts_accessories",
          skipAI: true,
          matched: true,
          matchRule: `parts:${pt}`,
        };
      }
    }
  }

  return noMatch;
}
