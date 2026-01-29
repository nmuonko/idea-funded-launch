/**
 * Motors Filter - Vehicle-Specific Filtering
 * 
 * AfriShop Vehicles & Parts Category Rules:
 * 
 * VEHICLES (unified_category = 'vehicles'):
 * 1. ONLY Buy It Now / Fixed Price items (no auctions)
 * 2. Minimum price $1,500 (filters out parts/accessories)
 * 3. Block parts, accessories, wheels, tires, etc.
 * 4. Block auction-related keywords: "auction", "bid", "bidding"
 * 
 * PARTS & ACCESSORIES (unified_category = 'parts_accessories'):
 * 1. All automotive parts, wheels, tires, accessories
 * 2. No minimum price requirement
 * 3. Can include any buying option
 */

// ─── Price Thresholds by Vehicle Type ────────────────────────────────────────
// NOTE: These are SOFT defaults - endpoints can override with minPrice=0
export const MOTORS_MIN_PRICE_USD = 0; // Changed from 1500 to allow full results
export const VEHICLES_MIN_PRICE_USD = 0; // Changed from 1500 to allow full results

// Suggested thresholds for specific categories (optional, not enforced by default)
export const VEHICLES_SUGGESTED_MIN_PRICE: Record<string, number> = {
  cars_trucks: 0, // No minimum - filter by keywords instead
  motorcycles: 0,
  powersports: 0,
  boats: 0,
  rvs_campers: 0,
  trailers_other: 0,
  classic_cars: 0,
};

// For backward compatibility - always returns 0 unless explicitly requested
export function getMinPriceForVehicleSubkey(subkey: string | null, enforceMinPrice: boolean = false): number {
  if (!enforceMinPrice) return 0;
  if (!subkey) return VEHICLES_MIN_PRICE_USD;
  return VEHICLES_SUGGESTED_MIN_PRICE[subkey] ?? 0;
}

// ─── Buying Options ─────────────────────────────────────────────────────────
// Only these buying options are allowed for vehicles (no auctions)
export const ALLOWED_BUYING_OPTIONS = ["FIXED_PRICE", "BUY_IT_NOW", "BEST_OFFER"];

// ─── Deny Keywords ──────────────────────────────────────────────────────────
// Items with these keywords in title are blocked from vehicles

export const MOTORS_PARTS_KEYWORDS = [
  // Wheels & Tires
  "wheel", "wheels", "tire", "tires", "rim", "rims",
  "hubcap", "hub cap", "lug nut",
  
  // Engine & Mechanical
  "engine", "motor part", "transmission", "alternator", "starter",
  "radiator", "carburetor", "fuel pump", "water pump", "oil pump",
  "brake pad", "brake rotor", "brake caliper", "brake line",
  "shock absorber", "strut", "suspension", "control arm",
  "timing belt", "serpentine belt", "timing chain",
  "spark plug", "ignition coil", "distributor",
  "catalytic converter", "muffler", "exhaust pipe", "exhaust manifold",
  "fuel injector", "throttle body", "intake manifold",
  "cylinder head", "crankshaft", "camshaft", "piston",
  "gasket", "seal", "bearing", "bushing",
  
  // Filters
  "oil filter", "air filter", "fuel filter", "cabin filter",
  
  // Electrical
  "battery", "headlight", "tail light", "brake light", "fog light",
  "turn signal", "bulb", "led light", "hid light",
  "wiper", "wiper blade", "wiper motor",
  "power window", "window motor", "window regulator",
  "door handle", "door lock", "door actuator",
  "mirror", "side mirror", "rear view",
  "horn", "relay", "fuse",
  
  // Interior
  "seat cover", "floor mat", "car mat", "cargo mat", "trunk liner",
  "steering wheel cover", "seat cushion", "headrest",
  "sun visor", "armrest", "center console",
  "dashboard cover", "dash mat",
  
  // Exterior
  "car cover", "bumper", "fender", "hood", "trunk lid",
  "spoiler", "body kit", "side skirt", "mud flap", "splash guard",
  "grille", "emblem", "badge", "decal", "vinyl wrap",
  "antenna", "roof rack", "cargo carrier",
  "license plate frame", "license plate holder",
  "tow hitch", "trailer hitch", "ball mount",
  
  // Accessories (non-vehicle items)
  "phone mount", "phone holder", "tablet mount",
  "dash cam", "dashcam", "backup camera", "rear camera",
  "gps", "navigation", "car charger", "usb charger",
  "air freshener", "organizer", "trash can", "garbage",
  "key fob", "key cover", "key case", "key chain",
  "sunshade", "windshield shade", "window tint",
  "projection light", "door projector", "logo light",
  "ice scraper", "snow brush", "emergency kit",
  "jumper cable", "jump starter", "tire inflator", "air compressor",
  "car wash", "wax", "polish", "detailing",
  
  // Repair/Parts indicators
  "replacement", "repair", "remanufactured", "rebuilt",
  "oem part", "aftermarket", "compatible with", "fits",
  "part number", "part #", "pn:", "oe#",
  
  // Generic parts
  "parts", "accessories", "accessory", "component", "kit",
  "hardware", "mounting", "bracket", "clamp", "bolt", "screw",
];

export const MOTORS_AUCTION_KEYWORDS = [
  "auction", "bid", "bidding", "reserve", "no reserve",
  "estate sale", "repo", "repossessed", "bank owned",
  "salvage", "salvage title", "rebuilt title", "flood damage",
  "for parts", "parts only", "not running", "project car",
  "needs work", "mechanic special", "fixer upper",
  "barn find", "as-is", "as is", "no warranty",
];

// ─── Filter Interface ───────────────────────────────────────────────────────

export interface MotorsFilterInput {
  title: string;
  priceUsd: number | null;
  buyingOptions?: string[];
  condition?: string;
  categoryPath?: string;
  vehiclesSubkey?: string | null; // For category-specific pricing
}

export interface MotorsFilterResult {
  isAllowed: boolean;
  reason: string | null;
  matchedKeyword: string | null;
}

// ─── Main Filter Function ───────────────────────────────────────────────────

/**
 * Check if a motor listing is allowed as a VEHICLE (not part/accessory)
 * Used for unified_category = 'vehicles'
 * 
 * NOTE: Price filtering is now done via keyword-based exclusion, not minPrice
 */
export function isAllowedMotorListing(input: MotorsFilterInput & { enforceMinPrice?: boolean }): MotorsFilterResult {
  const titleLower = (input.title || "").toLowerCase();
  const categoryPath = (input.categoryPath || "").toLowerCase();
  
  // Get appropriate minimum price for this vehicle subkey (only if enforced)
  const minPrice = getMinPriceForVehicleSubkey(input.vehiclesSubkey, input.enforceMinPrice ?? false);

  // 1. Check minimum price ONLY if explicitly enforced
  if (input.enforceMinPrice && (input.priceUsd === null || input.priceUsd < minPrice)) {
    return {
      isAllowed: false,
      reason: "price_below_minimum",
      matchedKeyword: `$${input.priceUsd} < $${minPrice}`,
    };
  }

  // 2. Check buying options (if provided) - only Fixed Price/Buy It Now allowed
  if (input.buyingOptions && input.buyingOptions.length > 0) {
    const hasAllowedOption = input.buyingOptions.some(opt => 
      ALLOWED_BUYING_OPTIONS.some(allowed => 
        opt.toUpperCase().includes(allowed)
      )
    );
    
    if (!hasAllowedOption) {
      return {
        isAllowed: false,
        reason: "auction_not_allowed",
        matchedKeyword: input.buyingOptions.join(", "),
      };
    }
  }

  // 3. Check auction keywords in title
  for (const keyword of MOTORS_AUCTION_KEYWORDS) {
    if (titleLower.includes(keyword.toLowerCase())) {
      return {
        isAllowed: false,
        reason: "auction_keyword",
        matchedKeyword: keyword,
      };
    }
  }

  // 4. Check parts/accessories keywords in title
  for (const keyword of MOTORS_PARTS_KEYWORDS) {
    if (titleLower.includes(keyword.toLowerCase())) {
      return {
        isAllowed: false,
        reason: "parts_accessory",
        matchedKeyword: keyword,
      };
    }
  }

  // 5. Check category path for parts indicators
  if (categoryPath.includes("parts") || 
      categoryPath.includes("accessories") || 
      categoryPath.includes("wheels") ||
      categoryPath.includes("tires")) {
    return {
      isAllowed: false,
      reason: "category_parts",
      matchedKeyword: categoryPath,
    };
  }

  // All checks passed
  return {
    isAllowed: true,
    reason: null,
    matchedKeyword: null,
  };
}

/**
 * Check if an item should be classified as a PART (not vehicle)
 * Used for unified_category = 'parts_accessories'
 */
export function isPartsListing(input: MotorsFilterInput): boolean {
  const titleLower = (input.title || "").toLowerCase();
  const categoryPath = (input.categoryPath || "").toLowerCase();

  // Check for parts keywords in title
  for (const keyword of MOTORS_PARTS_KEYWORDS) {
    if (titleLower.includes(keyword.toLowerCase())) {
      return true;
    }
  }

  // Check category path for parts indicators
  if (categoryPath.includes("parts") || 
      categoryPath.includes("accessories") || 
      categoryPath.includes("wheels") ||
      categoryPath.includes("tires")) {
    return true;
  }

  // Price below vehicle minimum likely indicates parts
  if (input.priceUsd !== null && input.priceUsd < VEHICLES_MIN_PRICE_USD) {
    // But only if from motors category
    if (categoryPath.includes("motors") || categoryPath.includes("auto")) {
      return true;
    }
  }

  return false;
}

/**
 * Filter an array of motor listings, keeping only allowed vehicles
 */
export function filterMotorListings<T extends MotorsFilterInput>(
  items: T[],
  logPrefix: string = "[MOTORS_FILTER]"
): { allowed: T[]; removed: number; reasons: Record<string, number> } {
  const allowed: T[] = [];
  const reasons: Record<string, number> = {};
  let removed = 0;

  for (const item of items) {
    const result = isAllowedMotorListing(item);
    if (result.isAllowed) {
      allowed.push(item);
    } else {
      removed++;
      const key = result.reason || "unknown";
      reasons[key] = (reasons[key] || 0) + 1;
    }
  }

  if (removed > 0) {
    console.log(`${logPrefix} removed=${removed} remaining=${allowed.length} reasons=${JSON.stringify(reasons)}`);
  }

  return { allowed, removed, reasons };
}

/**
 * Build eBay filter string for vehicles with optional subkey-specific pricing
 * @param subkey - vehicle subcategory
 * @param minPrice - explicit minimum price (default 0 for maximum results)
 */
export function buildEbayMotorsFilter(subkey?: string | null, minPrice: number = 0): string {
  // eBay Browse API filter format - FIXED_PRICE only, no auctions
  if (minPrice > 0) {
    return `buyingOptions:{FIXED_PRICE},price:[${minPrice}..],conditionIds:{1000|1500|2000|2500|3000}`;
  }
  // No price filter - just FIXED_PRICE and condition
  return `buyingOptions:{FIXED_PRICE},conditionIds:{1000|1500|2000|2500|3000}`;
}

/**
 * Build eBay filter string for vehicles (alias)
 */
export function buildEbayVehiclesFilter(subkey?: string | null, minPrice: number = 0): string {
  return buildEbayMotorsFilter(subkey, minPrice);
}

/**
 * Seed queries for VEHICLES category (actual vehicles, not parts)
 */
export const MOTORS_SEED_QUERIES = [
  // Cars & Trucks
  "used car",
  "toyota camry",
  "honda accord",
  "honda civic",
  "ford f150",
  "ford mustang",
  "chevrolet silverado",
  "bmw 3 series",
  "mercedes c class",
  "tesla model 3",
  "tesla model y",
  "lexus es",
  "audi a4",
  "nissan altima",
  "hyundai sonata",
  "kia optima",
  "mazda cx5",
  "subaru outback",
  "jeep wrangler",
  "dodge ram",
];

export const VEHICLES_SEED_QUERIES: Record<string, string[]> = {
  cars_trucks: [
    "used car", "cars and trucks", "SUV", "sedan", "pickup truck",
    "toyota camry", "honda accord", "ford f150", "chevrolet silverado",
    "tesla model 3", "bmw 3 series", "mercedes c class", "audi a4",
  ],
  motorcycles: [
    "motorcycle", "harley davidson", "honda motorcycle", "kawasaki ninja",
    "yamaha motorcycle", "ducati", "triumph motorcycle", "indian motorcycle",
  ],
  powersports: [
    "ATV UTV", "quad", "side by side", "polaris ranger", "can-am",
    "snowmobile", "jet ski", "sea-doo", "personal watercraft",
  ],
  boats: [
    "boat", "fishing boat", "pontoon boat", "yacht", "sailboat",
    "speedboat", "bass boat", "cabin cruiser",
  ],
  rvs_campers: [
    "RV camper", "motorhome", "travel trailer", "fifth wheel",
    "camper van", "recreational vehicle", "toy hauler",
  ],
  trailers_other: [
    "utility trailer", "cargo trailer", "enclosed trailer",
    "flatbed trailer", "dump trailer", "car hauler",
  ],
  classic_cars: [
    "classic car", "vintage car", "antique car", "muscle car",
    "collector car", "hot rod", "restored classic",
  ],
};

/**
 * Seed queries for PARTS & ACCESSORIES category
 */
export const PARTS_SEED_QUERIES: Record<string, string[]> = {
  all_parts: [
    "auto parts", "car parts", "automotive parts",
  ],
  car_truck_parts: [
    "car truck parts", "engine parts", "brake parts", "suspension parts",
    "transmission parts", "exhaust parts", "cooling system parts",
  ],
  wheels_tires: [
    "wheels tires", "car wheels", "truck tires", "alloy wheels",
    "tire set", "wheel set", "off road tires",
  ],
  moto_scooter_parts: [
    "motorcycle parts", "scooter parts", "harley parts", "motorcycle exhaust",
    "motorcycle seat", "motorcycle handlebar",
  ],
  atv_utv_parts: [
    "atv parts", "utv parts", "quad parts", "side by side parts",
    "atv tires", "utv accessories",
  ],
  tools_supplies: [
    "automotive tools", "car tools", "mechanic tools", "car cleaning supplies",
    "car wax polish", "car detailing", "oil change kit",
  ],
};

export default {
  MOTORS_MIN_PRICE_USD,
  VEHICLES_MIN_PRICE_USD,
  VEHICLES_SUGGESTED_MIN_PRICE,
  getMinPriceForVehicleSubkey,
  MOTORS_PARTS_KEYWORDS,
  MOTORS_AUCTION_KEYWORDS,
  MOTORS_SEED_QUERIES,
  VEHICLES_SEED_QUERIES,
  PARTS_SEED_QUERIES,
  isAllowedMotorListing,
  isPartsListing,
  filterMotorListings,
  buildEbayMotorsFilter,
  buildEbayVehiclesFilter,
};
