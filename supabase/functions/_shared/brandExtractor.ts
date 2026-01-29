/**
 * Brand Extractor - Extract brand names from product titles
 * Used for diversity enforcement in category results
 */

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

// Create lookup set for faster matching
const BRAND_SET = new Set(KNOWN_BRANDS);

// Create regex patterns for each brand (for word boundary matching)
const BRAND_PATTERNS: { brand: string; pattern: RegExp }[] = KNOWN_BRANDS.map(brand => ({
  brand,
  // Match brand name with word boundaries, handling special chars
  pattern: new RegExp(`\\b${brand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '[\\s-]?')}\\b`, 'i')
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
      return brand;
    }
  }
  
  return "other";
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
