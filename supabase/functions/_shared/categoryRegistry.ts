/**
 * Canonical Category Registry
 * 
 * Single source of truth for all category/subtab keys.
 * Provides alias resolution for backward compatibility.
 */

// ─── CANONICAL TABS ─────────────────────────────────────────────────────────────
export const CANONICAL_TABS = [
  "electronics",
  "vehicles",
  "home_garden",
  "clothing_shoes_accessories",
  "toys",
  "sporting_goods",
  "business_industrial",
  "jewelry_watches",
  "refurbished",
  "parts_accessories",
] as const;

export type CanonicalTab = typeof CANONICAL_TABS[number];

// ─── CANONICAL SUBTABS ──────────────────────────────────────────────────────────
export const CANONICAL_SUBTABS: Record<CanonicalTab, string[]> = {
  electronics: [
    "electronics_phones",
    "electronics_computers",
    "electronics_gaming",
    "electronics_cameras",
    "electronics_audio",
  ],
  vehicles: [
    "vehicles_all",
    "vehicles_cars_trucks",
    "vehicles_motorcycles",
    "vehicles_powersports",
    "vehicles_boats",
    "vehicles_rvs_campers",
    "vehicles_trailers_other",
    "vehicles_classic_cars",
    "vehicles_parts_accessories",
  ],
  home_garden: [],
  clothing_shoes_accessories: [
    "clothing_men",
    "clothing_women",
    "clothing_shoes",
    "clothing_bags",
  ],
  toys: [],
  sporting_goods: [],
  business_industrial: [],
  jewelry_watches: [],
  refurbished: [],
  parts_accessories: [],
};

// ─── ALL CANONICAL KEYS ─────────────────────────────────────────────────────────
function buildAllCanonicalKeys(): Set<string> {
  const keys = new Set<string>(CANONICAL_TABS);
  for (const subtabs of Object.values(CANONICAL_SUBTABS)) {
    for (const sub of subtabs) {
      keys.add(sub);
    }
  }
  return keys;
}

export const ALL_CANONICAL_KEYS = buildAllCanonicalKeys();

// ─── ALIAS MAP (shorthand -> canonical) ─────────────────────────────────────────
const ALIAS_MAP: Record<string, string> = {
  // Electronics shortcuts
  phones: "electronics_phones",
  computers: "electronics_computers",
  gaming: "electronics_gaming",
  cameras: "electronics_cameras",
  audio: "electronics_audio",
  
  // Clothing shortcuts
  men: "clothing_men",
  women: "clothing_women",
  shoes: "clothing_shoes",
  bags: "clothing_bags",
  
  // Vehicle shortcuts
  cars: "vehicles_cars_trucks",
  cars_trucks: "vehicles_cars_trucks",
  motorcycles: "vehicles_motorcycles",
  powersports: "vehicles_powersports",
  boats: "vehicles_boats",
  rvs: "vehicles_rvs_campers",
  rvs_campers: "vehicles_rvs_campers",
  trailers: "vehicles_trailers_other",
  trailers_other: "vehicles_trailers_other",
  classic_cars: "vehicles_classic_cars",
  
  // Parts shortcuts  
  parts: "parts_accessories",
  vehicle_parts: "vehicles_parts_accessories",
  
  // Tab aliases
  home: "home_garden",
  clothing: "clothing_shoes_accessories",
  jewelry: "jewelry_watches",
  watches: "jewelry_watches",
  business: "business_industrial",
  industrial: "business_industrial",
  sporting: "sporting_goods",
  sports: "sporting_goods",
};

// ─── RESOLUTION TYPES ───────────────────────────────────────────────────────────
export type ResolutionMethod = "exact" | "suffix" | "alias" | "none";

export interface CategoryResolution {
  resolved: string | null;
  parentTab: string | null;
  subtabKey: string | null;
  method: ResolutionMethod;
  isTab: boolean;
  isSubtab: boolean;
  isVehicle: boolean;
  isParts: boolean;
}

export interface CategoryResolutionError {
  error: "INVALID_CATEGORY";
  received: string;
  allowed: string[];
  suggestions: string[];
}

// ─── CORE RESOLVER ──────────────────────────────────────────────────────────────
/**
 * Resolve a category key to its canonical form.
 * 
 * Resolution order:
 * 1. Exact match (already canonical)
 * 2. Alias map lookup
 * 3. Suffix match (e.g., "phones" -> "electronics_phones")
 */
export function resolveCategory(input: string): CategoryResolution {
  const key = input.toLowerCase().trim();
  
  // 1. Exact match
  if (ALL_CANONICAL_KEYS.has(key)) {
    return buildResolution(key, "exact");
  }
  
  // 2. Alias map
  if (ALIAS_MAP[key]) {
    return buildResolution(ALIAS_MAP[key], "alias");
  }
  
  // 3. Suffix match - find subtab ending with "_" + key
  const suffixMatches: string[] = [];
  for (const canonical of ALL_CANONICAL_KEYS) {
    if (canonical.endsWith(`_${key}`)) {
      suffixMatches.push(canonical);
    }
  }
  
  if (suffixMatches.length === 1) {
    return buildResolution(suffixMatches[0], "suffix");
  }
  
  // No match found
  return {
    resolved: null,
    parentTab: null,
    subtabKey: null,
    method: "none",
    isTab: false,
    isSubtab: false,
    isVehicle: false,
    isParts: false,
  };
}

/**
 * Build resolution result with metadata
 */
function buildResolution(canonical: string, method: ResolutionMethod): CategoryResolution {
  const isTab = (CANONICAL_TABS as readonly string[]).includes(canonical);
  
  let parentTab: string | null = null;
  let subtabKey: string | null = null;
  
  if (isTab) {
    parentTab = canonical;
  } else {
    // Find parent tab
    for (const [tab, subtabs] of Object.entries(CANONICAL_SUBTABS)) {
      if (subtabs.includes(canonical)) {
        parentTab = tab;
        subtabKey = canonical;
        break;
      }
    }
  }
  
  const isVehicle = parentTab === "vehicles" && !canonical.includes("parts_accessories");
  const isParts = canonical === "parts_accessories" || canonical === "vehicles_parts_accessories";
  
  return {
    resolved: canonical,
    parentTab,
    subtabKey,
    method,
    isTab,
    isSubtab: !isTab && parentTab !== null,
    isVehicle,
    isParts,
  };
}

/**
 * Resolve category or return error payload
 */
export function resolveCategoryOrError(input: string): CategoryResolution | CategoryResolutionError {
  const result = resolveCategory(input);
  
  if (result.resolved) {
    return result;
  }
  
  // Build helpful error
  const suggestions = findSuggestions(input);
  
  return {
    error: "INVALID_CATEGORY",
    received: input,
    allowed: Array.from(ALL_CANONICAL_KEYS),
    suggestions,
  };
}

/**
 * Find similar keys for error suggestions
 */
function findSuggestions(input: string): string[] {
  const key = input.toLowerCase();
  const suggestions: string[] = [];
  
  for (const canonical of ALL_CANONICAL_KEYS) {
    // Contains the input
    if (canonical.includes(key) || key.includes(canonical)) {
      suggestions.push(canonical);
    }
  }
  
  // Also check aliases
  for (const [alias, canonical] of Object.entries(ALIAS_MAP)) {
    if (alias.includes(key) || key.includes(alias)) {
      if (!suggestions.includes(canonical)) {
        suggestions.push(canonical);
      }
    }
  }
  
  return suggestions.slice(0, 5);
}

// ─── CATEGORY METADATA ──────────────────────────────────────────────────────────
interface CategoryMeta {
  titleEn: string;
  titleFr: string;
  ebayCategory?: string;
  minPrice?: number;
  isVehicle: boolean;
  isParts: boolean;
}

export const CATEGORY_META: Record<string, CategoryMeta> = {
  // Top-level tabs
  electronics: { titleEn: "Electronics", titleFr: "Électronique", ebayCategory: "293", isVehicle: false, isParts: false },
  vehicles: { titleEn: "Vehicles", titleFr: "Véhicules", ebayCategory: "6000", isVehicle: true, isParts: false },
  home_garden: { titleEn: "Home & Garden", titleFr: "Maison & Jardin", ebayCategory: "11700", isVehicle: false, isParts: false },
  clothing_shoes_accessories: { titleEn: "Clothing, Shoes & Accessories", titleFr: "Vêtements, Chaussures & Accessoires", ebayCategory: "11450", isVehicle: false, isParts: false },
  toys: { titleEn: "Toys & Hobbies", titleFr: "Jouets & Loisirs", ebayCategory: "220", isVehicle: false, isParts: false },
  sporting_goods: { titleEn: "Sporting Goods", titleFr: "Articles de Sport", ebayCategory: "888", isVehicle: false, isParts: false },
  business_industrial: { titleEn: "Business & Industrial", titleFr: "Entreprise & Industrie", ebayCategory: "12576", isVehicle: false, isParts: false },
  jewelry_watches: { titleEn: "Jewelry & Watches", titleFr: "Bijoux & Montres", ebayCategory: "281", isVehicle: false, isParts: false },
  refurbished: { titleEn: "Refurbished", titleFr: "Reconditionné", ebayCategory: "", isVehicle: false, isParts: false },
  parts_accessories: { titleEn: "Parts & Accessories", titleFr: "Pièces & Accessoires", ebayCategory: "6028", isVehicle: false, isParts: true },
  
  // Electronics subtabs
  electronics_phones: { titleEn: "Phones", titleFr: "Téléphones", ebayCategory: "9355", isVehicle: false, isParts: false },
  electronics_computers: { titleEn: "Computers & Tablets", titleFr: "Ordinateurs & Tablettes", ebayCategory: "58058", isVehicle: false, isParts: false },
  electronics_gaming: { titleEn: "Gaming", titleFr: "Jeux Vidéo", ebayCategory: "1249", isVehicle: false, isParts: false },
  electronics_cameras: { titleEn: "Cameras & Photo", titleFr: "Appareils Photo", ebayCategory: "625", isVehicle: false, isParts: false },
  electronics_audio: { titleEn: "Audio", titleFr: "Audio", ebayCategory: "293", isVehicle: false, isParts: false },
  
  // Vehicles subtabs
  vehicles_all: { titleEn: "All Vehicles", titleFr: "Tous les Véhicules", ebayCategory: "6000", minPrice: 1500, isVehicle: true, isParts: false },
  vehicles_cars_trucks: { titleEn: "Cars & Trucks", titleFr: "Voitures & Camions", ebayCategory: "6001", minPrice: 1500, isVehicle: true, isParts: false },
  vehicles_motorcycles: { titleEn: "Motorcycles", titleFr: "Motos", ebayCategory: "6024", minPrice: 500, isVehicle: true, isParts: false },
  vehicles_powersports: { titleEn: "Powersports", titleFr: "Véhicules Motorisés", ebayCategory: "66466", minPrice: 300, isVehicle: true, isParts: false },
  vehicles_boats: { titleEn: "Boats", titleFr: "Bateaux", ebayCategory: "26429", minPrice: 1000, isVehicle: true, isParts: false },
  vehicles_rvs_campers: { titleEn: "RVs & Campers", titleFr: "Camping-cars", ebayCategory: "50054", minPrice: 2000, isVehicle: true, isParts: false },
  vehicles_trailers_other: { titleEn: "Trailers & Other Vehicles", titleFr: "Remorques & Autres", ebayCategory: "6038", minPrice: 300, isVehicle: true, isParts: false },
  vehicles_classic_cars: { titleEn: "Classic Cars", titleFr: "Voitures Classiques", ebayCategory: "6001", minPrice: 5000, isVehicle: true, isParts: false },
  vehicles_parts_accessories: { titleEn: "Parts & Accessories", titleFr: "Pièces & Accessoires", ebayCategory: "6028", isVehicle: false, isParts: true },
  
  // Clothing subtabs
  clothing_men: { titleEn: "Men's Clothing", titleFr: "Vêtements Hommes", ebayCategory: "1059", isVehicle: false, isParts: false },
  clothing_women: { titleEn: "Women's Clothing", titleFr: "Vêtements Femmes", ebayCategory: "15724", isVehicle: false, isParts: false },
  clothing_shoes: { titleEn: "Shoes", titleFr: "Chaussures", ebayCategory: "63889", isVehicle: false, isParts: false },
  clothing_bags: { titleEn: "Bags & Accessories", titleFr: "Sacs & Accessoires", ebayCategory: "169291", isVehicle: false, isParts: false },
};

/**
 * Get metadata for a category key
 */
export function getCategoryMeta(key: string): CategoryMeta | null {
  return CATEGORY_META[key] || null;
}

/**
 * Get eBay category ID for a canonical key
 */
export function getEbayCategoryId(key: string): string | null {
  return CATEGORY_META[key]?.ebayCategory || null;
}

/**
 * Get minimum price for a category
 */
export function getMinPrice(key: string): number {
  return CATEGORY_META[key]?.minPrice || 0;
}

// ─── VALIDATION HELPERS ─────────────────────────────────────────────────────────
/**
 * Check if a key is a valid canonical key
 */
export function isValidCanonicalKey(key: string): boolean {
  return ALL_CANONICAL_KEYS.has(key.toLowerCase());
}

/**
 * Check if a key is a top-level tab
 */
export function isTab(key: string): boolean {
  return (CANONICAL_TABS as readonly string[]).includes(key.toLowerCase());
}

/**
 * Check if a key is a subtab
 */
export function isSubtab(key: string): boolean {
  const k = key.toLowerCase();
  for (const subtabs of Object.values(CANONICAL_SUBTABS)) {
    if (subtabs.includes(k)) return true;
  }
  return false;
}

/**
 * Get parent tab for a subtab key
 */
export function getParentTab(subtabKey: string): string | null {
  const k = subtabKey.toLowerCase();
  for (const [tab, subtabs] of Object.entries(CANONICAL_SUBTABS)) {
    if (subtabs.includes(k)) return tab;
  }
  return null;
}

/**
 * Get all subtabs for a tab
 */
export function getSubtabs(tabKey: string): string[] {
  return CANONICAL_SUBTABS[tabKey as CanonicalTab] || [];
}
