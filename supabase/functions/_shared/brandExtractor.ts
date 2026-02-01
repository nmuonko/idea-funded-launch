/**
 * Brand Extractor - Extract brand names from product titles
 * Used for diversity enforcement in category results
 * 
 * ENHANCED: Now includes electronics brands for phone/computer diversity
 */

// ─── ELECTRONICS BRANDS ───────────────────────────────────────────────────────
// Phone brands (ordered by global market share / popularity)
export const PHONE_BRANDS = [
  "apple", "iphone", "samsung", "galaxy", "google", "pixel",
  "oneplus", "oppo", "vivo", "xiaomi", "redmi", "poco",
  "realme", "motorola", "moto", "nokia", "huawei", "honor",
  "tecno", "infinix", "itel", "lg", "sony", "asus", "rog",
  "nothing", "fairphone", "blackberry", "zte",
];

// Computer / Laptop brands
export const COMPUTER_BRANDS = [
  "apple", "macbook", "imac", "dell", "hp", "lenovo", "thinkpad",
  "asus", "acer", "msi", "razer", "alienware", "microsoft", "surface",
  "samsung", "lg", "toshiba", "gigabyte", "aorus", "chromebook",
];

// Gaming brands
export const GAMING_BRANDS = [
  "sony", "playstation", "ps5", "ps4", "microsoft", "xbox",
  "nintendo", "switch", "steam", "valve", "razer", "logitech",
  "corsair", "hyperx", "steelseries", "roccat", "asus", "rog",
  "alienware", "msi", "scuf", "8bitdo", "powera",
];

// Audio / Headphones brands
export const AUDIO_BRANDS = [
  "apple", "airpods", "bose", "sony", "jbl", "samsung", "beats",
  "sennheiser", "audio-technica", "beyerdynamic", "skullcandy",
  "anker", "soundcore", "jabra", "marshall", "harman", "bang olufsen",
  "shure", "akg", "klipsch", "denon", "sonos",
];

// Common fashion and accessory brands (ordered by popularity/recognition)
export const KNOWN_BRANDS = [
  // Athletic / Sportswear
  "nike", "adidas", "puma", "new balance", "reebok", "under armour", "jordan",
  "fila", "asics", "skechers", "converse", "vans", "champion", "columbia",
  "north face", "patagonia", "lululemon", "gymshark",
  
  // Luxury / Designer
  "gucci", "louis vuitton", "prada", "versace", "armani", "burberry", "fendi",
  "balenciaga", "dior", "chanel", "hermes", "valentino", "givenchy", "bottega veneta",
  "yves saint laurent", "ysl", "dolce gabbana", "coach", "michael kors", "kate spade",
  "marc jacobs", "tory burch", "ralph lauren", "polo ralph lauren",
  
  // Casual / Mass Market
  "levi's", "levis", "tommy hilfiger", "calvin klein", "gap", "zara", "h&m", "hm",
  "uniqlo", "forever 21", "old navy", "american eagle", "hollister", "abercrombie",
  "aeropostale", "express", "guess", "diesel", "wrangler", "lee", "carhartt",
  
  // Footwear
  "timberland", "dr martens", "doc martens", "birkenstock", "crocs", "ugg", "clarks",
  "steve madden", "aldo", "nine west", "cole haan", "ecco", "merrell", "salomon",
  
  // Accessories
  "ray-ban", "rayban", "oakley", "fossil", "casio", "seiko", "tissot", "movado",
  "pandora", "swarovski", "tiffany",
  
  // Other fashion
  "lacoste", "hugo boss", "banana republic", "j. crew", "brooks brothers",
  "anthropologie", "free people", "madewell", "everlane", "cos", "massimo dutti",
];

// Combine all electronics brands
export const ELECTRONICS_BRANDS = [
  ...new Set([...PHONE_BRANDS, ...COMPUTER_BRANDS, ...GAMING_BRANDS, ...AUDIO_BRANDS])
];

// Combine all known brands (fashion + electronics)
export const ALL_BRANDS = [
  ...new Set([...KNOWN_BRANDS, ...ELECTRONICS_BRANDS])
];

// Create lookup set for faster matching
const BRAND_SET = new Set(ALL_BRANDS);

// Create regex patterns for each brand (for word boundary matching)
const BRAND_PATTERNS: { brand: string; pattern: RegExp }[] = ALL_BRANDS.map(brand => ({
  brand,
  // Match brand name with word boundaries, handling special chars
  pattern: new RegExp(`\\b${brand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '[\\s-]?')}\\b`, 'i')
}));

// Category-specific brand patterns for faster matching
const PHONE_PATTERNS = PHONE_BRANDS.map(brand => ({
  brand,
  pattern: new RegExp(`\\b${brand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i')
}));

const GAMING_PATTERNS = GAMING_BRANDS.map(brand => ({
  brand,
  pattern: new RegExp(`\\b${brand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i')
}));

/**
 * Extract the primary brand from a product title
 * Returns normalized lowercase brand name or "other" if no known brand found
 */
export function extractBrand(title: string): string {
  if (!title) return "other";
  
  const lowerTitle = title.toLowerCase();
  
  // Check each brand pattern
  for (const { brand, pattern } of BRAND_PATTERNS) {
    if (pattern.test(title)) {
      // Normalize brand name (handle variations)
      if (brand === "levi's" || brand === "levis") return "levis";
      if (brand === "h&m" || brand === "hm") return "h&m";
      if (brand === "dr martens" || brand === "doc martens") return "dr martens";
      if (brand === "ray-ban" || brand === "rayban") return "ray-ban";
      if (brand === "yves saint laurent" || brand === "ysl") return "ysl";
      if (brand === "polo ralph lauren") return "ralph lauren";
      if (brand === "north face") return "the north face";
      // Normalize electronics brands
      if (brand === "iphone") return "apple";
      if (brand === "galaxy") return "samsung";
      if (brand === "pixel") return "google";
      if (brand === "macbook" || brand === "imac") return "apple";
      if (brand === "thinkpad") return "lenovo";
      if (brand === "surface") return "microsoft";
      if (brand === "rog" || brand === "aorus") return "asus";
      if (brand === "playstation" || brand === "ps5" || brand === "ps4") return "sony";
      if (brand === "xbox") return "microsoft";
      if (brand === "switch") return "nintendo";
      if (brand === "airpods" || brand === "beats") return "apple";
      if (brand === "soundcore") return "anker";
      if (brand === "redmi" || brand === "poco") return "xiaomi";
      if (brand === "moto") return "motorola";
      return brand;
    }
  }
  
  return "other";
}

/**
 * Extract brand specifically for electronics (phones, computers, gaming)
 * More aggressive matching for electronics brands
 */
export function extractElectronicsBrand(title: string): string {
  if (!title) return "other";
  
  // Check phone-specific patterns first
  for (const { brand, pattern } of PHONE_PATTERNS) {
    if (pattern.test(title)) {
      // Normalize
      if (brand === "iphone") return "apple";
      if (brand === "galaxy") return "samsung";
      if (brand === "pixel") return "google";
      if (brand === "redmi" || brand === "poco") return "xiaomi";
      if (brand === "moto") return "motorola";
      return brand;
    }
  }
  
  // Fall back to general extraction
  return extractBrand(title);
}

/**
 * Check if a title contains any known brand
 */
export function hasBrand(title: string): boolean {
  return extractBrand(title) !== "other";
}

/**
 * Get all brands mentioned in a title (for items with multiple brand mentions)
 */
export function extractAllBrands(title: string): string[] {
  if (!title) return [];
  
  const brands: string[] = [];
  
  for (const { brand, pattern } of BRAND_PATTERNS) {
    if (pattern.test(title)) {
      // Normalize and add
      const normalized = extractBrand(brand);
      if (!brands.includes(normalized)) {
        brands.push(normalized);
      }
    }
  }
  
  return brands;
}

/**
 * Apply brand diversity to a list of items
 * Ensures no single brand dominates the first N results
 * 
 * @param items Array of items with title property
 * @param maxPerBrand Maximum items per brand in the result
 * @param targetCount Target number of items to return
 * @returns Diversified array of items
 */
export function applyBrandDiversity<T extends { title: string }>(
  items: T[],
  maxPerBrand: number = 2,
  targetCount: number = 20
): T[] {
  if (items.length === 0) return [];
  
  // Group items by brand
  const brandBuckets: Map<string, T[]> = new Map();
  
  for (const item of items) {
    const brand = extractBrand(item.title);
    if (!brandBuckets.has(brand)) {
      brandBuckets.set(brand, []);
    }
    brandBuckets.get(brand)!.push(item);
  }
  
  const result: T[] = [];
  const brandCounts: Map<string, number> = new Map();
  const usedItems = new Set<number>();
  
  // First pass: pick up to maxPerBrand from each brand, round-robin style
  const brands = Array.from(brandBuckets.keys());
  let idx = 0;
  let iterations = 0;
  const maxIterations = items.length * 2; // Safety limit
  
  while (result.length < targetCount && iterations < maxIterations) {
    const brand = brands[idx % brands.length];
    const bucket = brandBuckets.get(brand)!;
    const currentCount = brandCounts.get(brand) || 0;
    
    if (currentCount < maxPerBrand) {
      // Find next unused item from this brand
      const itemIdx = bucket.findIndex((item, i) => {
        const globalIdx = items.indexOf(item);
        return !usedItems.has(globalIdx);
      });
      
      if (itemIdx !== -1) {
        const item = bucket[itemIdx];
        const globalIdx = items.indexOf(item);
        result.push(item);
        usedItems.add(globalIdx);
        brandCounts.set(brand, currentCount + 1);
      }
    }
    
    idx++;
    iterations++;
    
    // If we've gone through all brands and still need more, break for second pass
    if (idx % brands.length === 0 && result.length < targetCount) {
      const allBrandsAtMax = Array.from(brandBuckets.keys()).every(b => 
        (brandCounts.get(b) || 0) >= maxPerBrand
      );
      if (allBrandsAtMax) break;
    }
  }
  
  // Second pass: if we still need more items and have brands at max, fill with remaining
  if (result.length < targetCount) {
    for (const item of items) {
      if (result.length >= targetCount) break;
      const globalIdx = items.indexOf(item);
      if (!usedItems.has(globalIdx)) {
        result.push(item);
        usedItems.add(globalIdx);
      }
    }
  }
  
  return result;
}

/**
 * Universal item diversity function
 * Works for any category: electronics, clothing, vehicles, etc.
 * Interleaves items by detected brand to avoid clusters
 * 
 * @param items Array of items with title property
 * @param options Configuration options
 * @returns Diversified array of items
 */
export interface ItemDiversityOptions {
  maxPerBrand?: number;       // Max consecutive items from same brand (default: 2)
  targetCount?: number;       // Target number of items to return
  categoryHint?: string;      // Category hint for better brand detection
  shuffle?: boolean;          // Shuffle brand order for randomness (default: false)
}

export function applyItemDiversity<T extends { title: string }>(
  items: T[],
  options: ItemDiversityOptions = {}
): T[] {
  const {
    maxPerBrand = 2,
    targetCount = items.length,
    categoryHint,
    shuffle = false,
  } = options;

  if (items.length <= maxPerBrand) return items;

  // Use category-specific brand extraction if available
  const extractFn = categoryHint?.startsWith("electronics") 
    ? extractElectronicsBrand 
    : extractBrand;

  // Group items by brand
  const brandBuckets: Map<string, T[]> = new Map();
  
  for (const item of items) {
    const brand = extractFn(item.title);
    if (!brandBuckets.has(brand)) {
      brandBuckets.set(brand, []);
    }
    brandBuckets.get(brand)!.push(item);
  }

  // Get brand list (optionally shuffle for randomness)
  let brands = Array.from(brandBuckets.keys());
  
  // Move "other" to end to prioritize known brands
  const otherIdx = brands.indexOf("other");
  if (otherIdx > -1) {
    brands.splice(otherIdx, 1);
    brands.push("other");
  }

  // Optionally shuffle (but keep "other" at end)
  if (shuffle && brands.length > 2) {
    const shuffleable = brands.slice(0, -1);
    for (let i = shuffleable.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffleable[i], shuffleable[j]] = [shuffleable[j], shuffleable[i]];
    }
    brands = [...shuffleable, "other"];
  }

  const result: T[] = [];
  const brandIndices: Map<string, number> = new Map();
  
  // Initialize indices
  for (const brand of brands) {
    brandIndices.set(brand, 0);
  }

  // Round-robin through brands
  let roundsWithNoProgress = 0;
  
  while (result.length < targetCount && roundsWithNoProgress < 2) {
    let madeProgress = false;
    
    for (const brand of brands) {
      if (result.length >= targetCount) break;
      
      const bucket = brandBuckets.get(brand)!;
      const idx = brandIndices.get(brand)!;
      
      // Take up to maxPerBrand items from this brand
      for (let i = 0; i < maxPerBrand && idx + i < bucket.length && result.length < targetCount; i++) {
        result.push(bucket[idx + i]);
        madeProgress = true;
      }
      
      brandIndices.set(brand, idx + maxPerBrand);
    }
    
    if (!madeProgress) {
      roundsWithNoProgress++;
    } else {
      roundsWithNoProgress = 0;
    }
  }

  return result;
}

/**
 * Log brand distribution for debugging
 */
export function logBrandDistribution<T extends { title: string }>(
  items: T[],
  prefix: string = "[BRAND_DIST]"
): void {
  const distribution: Record<string, number> = {};
  
  for (const item of items) {
    const brand = extractBrand(item.title);
    distribution[brand] = (distribution[brand] || 0) + 1;
  }
  
  const sorted = Object.entries(distribution)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);
  
  console.log(`${prefix} Total=${items.length} TopBrands:`, sorted);
}
