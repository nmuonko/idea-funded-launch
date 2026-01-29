/**
 * Motors Filter - Vehicle-Specific Filtering
 * 
 * AfriShop Motors category rules:
 * 1. ONLY Buy It Now / Fixed Price items (no auctions)
 * 2. Minimum price $1,500 (filters out parts/accessories)
 * 3. Block parts, accessories, wheels, tires, etc.
 * 4. Block auction-related keywords
 */

// ─── Price Threshold ────────────────────────────────────────────────────────
export const MOTORS_MIN_PRICE_USD = 1500;

// ─── Buying Options ─────────────────────────────────────────────────────────
// Only these buying options are allowed for motors
export const ALLOWED_BUYING_OPTIONS = ["FIXED_PRICE", "BUY_IT_NOW", "BEST_OFFER"];

// ─── Deny Keywords ──────────────────────────────────────────────────────────
// Items with these keywords in title are blocked from motors

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
}

export interface MotorsFilterResult {
  isAllowed: boolean;
  reason: string | null;
  matchedKeyword: string | null;
}

// ─── Main Filter Function ───────────────────────────────────────────────────

/**
 * Check if a motor listing is allowed (actual vehicle, not part/accessory)
 */
export function isAllowedMotorListing(input: MotorsFilterInput): MotorsFilterResult {
  const titleLower = (input.title || "").toLowerCase();
  const categoryPath = (input.categoryPath || "").toLowerCase();

  // 1. Check minimum price
  if (input.priceUsd === null || input.priceUsd < MOTORS_MIN_PRICE_USD) {
    return {
      isAllowed: false,
      reason: "price_below_minimum",
      matchedKeyword: `$${input.priceUsd} < $${MOTORS_MIN_PRICE_USD}`,
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
 * Build eBay filter string for motors (fixed price + minimum price)
 */
export function buildEbayMotorsFilter(): string {
  // eBay Browse API filter format
  return `buyingOptions:{FIXED_PRICE},price:[${MOTORS_MIN_PRICE_USD}..],conditionIds:{1000|1500|2000|2500|3000}`;
}

/**
 * Seed queries for motors category (actual vehicles, not parts)
 */
export const MOTORS_SEED_QUERIES = [
  // Specific vehicle searches
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

export default {
  MOTORS_MIN_PRICE_USD,
  MOTORS_PARTS_KEYWORDS,
  MOTORS_AUCTION_KEYWORDS,
  MOTORS_SEED_QUERIES,
  isAllowedMotorListing,
  filterMotorListings,
  buildEbayMotorsFilter,
};
