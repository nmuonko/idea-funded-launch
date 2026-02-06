/**
 * Title Normalizer - PERMANENT FIX for "Section" fallback issue
 * 
 * This module ensures section titles are NEVER empty strings.
 * Mobile app does: section.title || section.name || "Section"
 * So title="" triggers the "Section" fallback.
 * 
 * This normalizer runs RIGHT BEFORE returning any response to guarantee
 * all sections have proper non-empty titles.
 */

// Cache schema version - increment when making breaking changes
// Old cache rows with different version will be treated as cache miss
// V4: Force invalidation after mobile section title fix (2024-02-06)
export const CACHE_SCHEMA_VERSION = 4;

// Helper: Returns non-empty string or null
export function nonEmpty(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s.length > 0 ? s : null;
}

// Guaranteed non-empty title map for all known section keys
export const TITLE_MAP: Record<string, { en: string; fr: string }> = {
  phones: { en: "Phones", fr: "Téléphones" },
  electronics: { en: "Electronics", fr: "Électronique" },
  vehicles: { en: "Vehicles", fr: "Véhicules" },
  video_games: { en: "Video Games", fr: "Jeux Vidéo" },
  clothing_fashion: { en: "Clothing & Fashion", fr: "Vêtements et Mode" },
  home_garden: { en: "Home & Garden", fr: "Maison et Jardin" },
  toys: { en: "Toys", fr: "Jouets" },
  sporting_goods: { en: "Sporting Goods", fr: "Articles de Sport" },
  refurbished: { en: "Refurbished Deals", fr: "Offres Reconditionnées" },
  featured: { en: "Featured", fr: "En vedette" },
};

// Default fallback titles (used when key is unknown)
const DEFAULT_TITLES = { en: "Featured", fr: "En vedette" };

export interface Section {
  key?: string;
  title?: string;
  title_en?: string;
  title_fr?: string;
  titleEn?: string;
  titleFr?: string;
  name?: string;
  items?: unknown[];
  [k: string]: unknown;
}

/**
 * Normalize section titles - MUST run before returning ANY response
 * Ensures title is NEVER "" (empty string)
 * 
 * @param sections - Array of sections to normalize
 * @param lang - Language preference ("fr" | "en")
 * @returns Normalized sections with guaranteed non-empty titles
 */
export function normalizeSectionTitles(sections: Section[], lang: "fr" | "en" = "fr"): Section[] {
  if (!sections || !Array.isArray(sections)) {
    return [];
  }

  return sections.map((sec) => {
    // Normalize key - default to "featured" if empty
    const key = nonEmpty(sec.key) || "featured";
    
    // Try to get titles from existing fields (various naming conventions)
    const existingFr = nonEmpty(sec.title_fr) || nonEmpty(sec.titleFr);
    const existingEn = nonEmpty(sec.title_en) || nonEmpty(sec.titleEn);
    const existingTitle = nonEmpty(sec.title) || nonEmpty(sec.name);
    
    // Get mapped titles for this key (fallback to default if key unknown)
    const mapped = TITLE_MAP[key] || DEFAULT_TITLES;
    
    // Final titles - use existing if valid, otherwise use mapped
    const finalFr = existingFr || mapped.fr;
    const finalEn = existingEn || mapped.en;
    
    // CRITICAL: title field must NEVER be empty string
    // This is what mobile app uses first: section.title || section.name || "Section"
    let finalTitle = existingTitle;
    if (!finalTitle) {
      finalTitle = lang === "fr" ? finalFr : finalEn;
    }
    // Double-safety: if still empty somehow, force from map
    if (!finalTitle) {
      finalTitle = mapped.fr; // Default to French (primary market)
    }
    
    return {
      ...sec,
      key,
      title: finalTitle,
      title_fr: finalFr,
      title_en: finalEn,
    };
  });
}

/**
 * Check if a cache entry has valid schema version
 * Returns false if cache should be treated as miss
 */
export function isCacheSchemaValid(cacheEntry: { schema_version?: number } | null): boolean {
  if (!cacheEntry) return false;
  return cacheEntry.schema_version === CACHE_SCHEMA_VERSION;
}

/**
 * Determine the response language from request headers
 */
export function getResponseLanguage(req: Request): "fr" | "en" {
  const acceptLanguage = (req.headers.get("accept-language") || "").toLowerCase();
  
  // Check for English preference
  if (acceptLanguage.includes("en") && !acceptLanguage.includes("fr")) {
    return "en";
  }
  
  // Check URL param
  try {
    const url = new URL(req.url);
    const locale = url.searchParams.get("locale") || url.searchParams.get("lang") || "";
    if (locale.toLowerCase() === "en") {
      return "en";
    }
  } catch {
    // Ignore URL parse errors
  }
  
  // Default to French (primary market)
  return "fr";
}

/**
 * Calculate total items across all sections
 */
export function calculateTotalItems(sections: Section[]): number {
  if (!sections || !Array.isArray(sections)) return 0;
  return sections.reduce((sum, s) => sum + (Array.isArray(s.items) ? s.items.length : 0), 0);
}

/**
 * Determine ok status based on total items
 * For mobile: ok:true if at least 1 item exists
 * For web: ok:true if at least 1 item exists
 */
export function calculateOkStatus(sections: Section[]): boolean {
  return calculateTotalItems(sections) > 0;
}
