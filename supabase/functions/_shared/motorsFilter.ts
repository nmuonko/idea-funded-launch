/**
 * Motors Filter - Vehicle-Specific Filtering (STRICT MODE)
 * 
 * AfriShop Vehicles Category Rules:
 * 
 * VEHICLES (unified_category = 'vehicles'):
 * 1. ONLY Buy It Now / Fixed Price items (NO auctions)
 * 2. Minimum price $1,500 (ENFORCED by default for vehicles)
 * 3. STRONG exclusion of parts, accessories, wheels, tires, etc.
 * 4. Block auction-related keywords: "auction", "bid", "bidding"
 * 5. Prefer eBay category path validation when available
 * 
 * PARTS & ACCESSORIES (unified_category = 'parts_accessories'):
 * - Separate category for automotive parts
 * - No minimum price requirement
 * - Can include any buying option
 */

// ─── Price Thresholds (ENFORCED for vehicles) ────────────────────────────────
export const VEHICLES_MIN_PRICE_USD = 1500; // ENFORCED minimum for real vehicles

// Suggested thresholds for specific vehicle categories
// These help exclude small parts but still allow affordable vehicles
export const VEHICLES_SUGGESTED_MIN_PRICE: Record<string, number> = {
  cars_trucks: 1500,     // Real cars/trucks are $1500+
  motorcycles: 800,      // Real motorcycles start at $800+
  powersports: 500,      // ATVs can be cheaper (used)
  boats: 500,            // Small boats/kayaks
  rvs_campers: 2000,     // RVs are expensive
  trailers_other: 300,   // Utility trailers
  classic_cars: 3000,    // Classic cars are valuable
};

// Get minimum price for vehicle subkey (ALWAYS ENFORCED for vehicles)
export function getMinPriceForVehicleSubkey(subkey: string | null): number {
  if (!subkey) return VEHICLES_MIN_PRICE_USD;
  return VEHICLES_SUGGESTED_MIN_PRICE[subkey] ?? VEHICLES_MIN_PRICE_USD;
}

// For backward compatibility
export const MOTORS_MIN_PRICE_USD = VEHICLES_MIN_PRICE_USD;

// ─── Buying Options ─────────────────────────────────────────────────────────
// ONLY these buying options are allowed for vehicles (NO auctions)
export const ALLOWED_BUYING_OPTIONS = ["FIXED_PRICE", "BUY_IT_NOW", "BEST_OFFER"];

// ─── COMPREHENSIVE Parts/Accessories Keywords (EXPANDED) ─────────────────────
// Items with these keywords in title are BLOCKED from vehicles category

export const MOTORS_PARTS_KEYWORDS = [
  // ═══════════════════════════════════════════════════════════════════════════
  // SENSORS & ELECTRONICS
  // ═══════════════════════════════════════════════════════════════════════════
  "tpms", "sensor", "sensors", "valve stem", "valve cap", "tire pressure",
  "antenna", "radio antenna", "power antenna", "shark fin antenna",
  "relay", "fuse", "switch", "module", "ecu", "pcm", "ecm",
  
  // ═══════════════════════════════════════════════════════════════════════════
  // WHEELS, TIRES & HUB CAPS
  // ═══════════════════════════════════════════════════════════════════════════
  "wheel", "wheels", "tire", "tires", "rim", "rims",
  "hubcap", "hub cap", "hubcaps", "hub caps", "wheel cover", "wheel covers",
  "lug nut", "lug nuts", "lug bolt", "wheel lock", "center cap", "center caps",
  "valve stem", "tire valve", "wheel spacer", "wheel adapter",
  "alloy wheel", "steel wheel", "chrome wheel", "beadlock",
  
  // ═══════════════════════════════════════════════════════════════════════════
  // ENGINE & MECHANICAL PARTS
  // ═══════════════════════════════════════════════════════════════════════════
  "engine", "motor part", "engine part", "transmission", "gearbox",
  "alternator", "starter", "starter motor", "generator",
  "radiator", "carburetor", "carb", "fuel pump", "water pump", "oil pump",
  "turbo", "turbocharger", "supercharger", "intercooler",
  "cylinder head", "crankshaft", "camshaft", "piston", "connecting rod",
  "valve", "valves", "lifter", "rocker arm", "timing chain", "timing belt",
  "serpentine belt", "drive belt", "fan belt", "v-belt",
  "throttle body", "intake manifold", "exhaust manifold",
  "fuel injector", "injector", "fuel rail", "throttle cable",
  "differential", "diff", "front differential", "rear differential", "axle",
  "clutch", "flywheel", "pressure plate", "torque converter",
  
  // ═══════════════════════════════════════════════════════════════════════════
  // BRAKES
  // ═══════════════════════════════════════════════════════════════════════════
  "brake", "brakes", "brake pad", "brake pads", "brake shoe", "brake shoes",
  "brake rotor", "brake rotors", "brake disc", "brake discs",
  "brake caliper", "caliper", "brake line", "brake hose",
  "brake fluid", "brake master", "master cylinder", "abs module",
  "parking brake", "e-brake", "emergency brake",
  
  // ═══════════════════════════════════════════════════════════════════════════
  // SUSPENSION & STEERING
  // ═══════════════════════════════════════════════════════════════════════════
  "shock", "shocks", "shock absorber", "strut", "struts", "coilover",
  "suspension", "spring", "springs", "coil spring", "leaf spring",
  "control arm", "a-arm", "ball joint", "tie rod", "tie-rod",
  "sway bar", "stabilizer bar", "end link", "bushing", "bushings",
  "steering rack", "power steering", "steering pump", "steering column",
  "cv joint", "cv axle", "axle shaft", "u-joint", "driveshaft",
  
  // ═══════════════════════════════════════════════════════════════════════════
  // EXHAUST SYSTEM
  // ═══════════════════════════════════════════════════════════════════════════
  "exhaust", "muffler", "exhaust pipe", "catalytic converter", "cat converter",
  "exhaust manifold", "header", "headers", "downpipe", "resonator",
  "tailpipe", "exhaust tip", "flex pipe", "o2 sensor", "oxygen sensor",
  
  // ═══════════════════════════════════════════════════════════════════════════
  // FILTERS
  // ═══════════════════════════════════════════════════════════════════════════
  "filter", "filters", "oil filter", "air filter", "fuel filter",
  "cabin filter", "cabin air", "transmission filter", "air intake",
  
  // ═══════════════════════════════════════════════════════════════════════════
  // ELECTRICAL & LIGHTING
  // ═══════════════════════════════════════════════════════════════════════════
  "headlight", "headlamp", "tail light", "taillight", "brake light",
  "fog light", "fog lamp", "turn signal", "blinker", "indicator light",
  "bulb", "bulbs", "led bulb", "hid bulb", "led light", "hid light",
  "lamp", "lamps", "light bar", "work light",
  "battery", "car battery", "battery terminal", "battery cable",
  "ignition coil", "coil pack", "spark plug", "spark plugs", "glow plug",
  "distributor", "distributor cap", "ignition wire", "plug wire",
  "wiring harness", "harness", "connector", "wire",
  
  // ═══════════════════════════════════════════════════════════════════════════
  // GASKETS & SEALS
  // ═══════════════════════════════════════════════════════════════════════════
  "gasket", "gaskets", "head gasket", "intake gasket", "exhaust gasket",
  "valve cover gasket", "oil pan gasket", "seal", "seals", "o-ring",
  "bearing", "bearings", "wheel bearing", "hub bearing",
  
  // ═══════════════════════════════════════════════════════════════════════════
  // BODY PARTS & PANELS
  // ═══════════════════════════════════════════════════════════════════════════
  "bumper", "front bumper", "rear bumper", "bumper cover",
  "fender", "fenders", "quarter panel", "rocker panel",
  "hood", "bonnet", "trunk lid", "tailgate", "liftgate",
  "door panel", "door shell", "door skin",
  "grille", "grill", "front grille", "radiator grille",
  "spoiler", "wing", "body kit", "side skirt", "splitter",
  "mud flap", "splash guard", "fender liner", "wheel well liner",
  
  // ═══════════════════════════════════════════════════════════════════════════
  // MIRRORS & GLASS
  // ═══════════════════════════════════════════════════════════════════════════
  "mirror", "mirrors", "side mirror", "door mirror", "rear view",
  "rearview", "tow mirror", "towing mirror",
  "windshield", "window", "glass", "side glass", "rear window",
  
  // ═══════════════════════════════════════════════════════════════════════════
  // WIPERS
  // ═══════════════════════════════════════════════════════════════════════════
  "wiper", "wipers", "wiper blade", "wiper arm", "wiper motor",
  "windshield wiper", "rain sensor",
  
  // ═══════════════════════════════════════════════════════════════════════════
  // INTERIOR PARTS
  // ═══════════════════════════════════════════════════════════════════════════
  "seat cover", "seat covers", "floor mat", "floor mats", "car mat", "car mats",
  "cargo mat", "trunk mat", "trunk liner", "cargo liner",
  "steering wheel cover", "seat cushion", "headrest",
  "sun visor", "visor", "armrest", "center console", "console lid",
  "dashboard cover", "dash cover", "dash mat", "dash panel",
  "shift knob", "gear knob", "shift boot", "e-brake boot",
  "pedal cover", "pedal pad", "door handle", "interior handle",
  
  // ═══════════════════════════════════════════════════════════════════════════
  // CAR COVERS & PROTECTION
  // ═══════════════════════════════════════════════════════════════════════════
  "car cover", "vehicle cover", "truck cover", "suv cover",
  "bra", "front end bra", "hood bra", "bumper protector",
  "door edge", "door guard", "paint protection",
  
  // ═══════════════════════════════════════════════════════════════════════════
  // EMBLEMS & DECOR
  // ═══════════════════════════════════════════════════════════════════════════
  "emblem", "emblems", "badge", "badges", "logo", "nameplate",
  "decal", "decals", "sticker", "stickers", "vinyl wrap",
  "pinstripe", "stripe", "stripes", "graphic", "graphics",
  "license plate frame", "license plate holder", "plate frame",
  
  // ═══════════════════════════════════════════════════════════════════════════
  // ACCESSORIES & ELECTRONICS
  // ═══════════════════════════════════════════════════════════════════════════
  "phone mount", "phone holder", "tablet mount", "cup holder",
  "dash cam", "dashcam", "backup camera", "rear camera", "reverse camera",
  "gps", "gps mount", "navigation", "car charger", "usb charger", "usb port",
  "air freshener", "freshener", "organizer", "trash can", "garbage",
  "sunshade", "windshield shade", "window shade", "window tint", "tint",
  "projection light", "door projector", "logo light", "puddle light",
  "key fob", "key cover", "key case", "key chain", "keychain",
  "remote start", "alarm", "car alarm", "security system",
  "stereo", "radio", "head unit", "speaker", "speakers", "subwoofer",
  "amplifier", "amp", "car audio", "bluetooth adapter", "aux cable",
  "carplay", "android auto",
  
  // ═══════════════════════════════════════════════════════════════════════════
  // TOOLS & MAINTENANCE
  // ═══════════════════════════════════════════════════════════════════════════
  "ice scraper", "snow brush", "emergency kit", "first aid",
  "jumper cable", "jump starter", "battery charger", "battery tender",
  "tire inflator", "air compressor", "tire gauge", "pressure gauge",
  "jack", "jack stand", "lug wrench", "wheel chock",
  "tow rope", "tow strap", "recovery strap", "winch",
  "car wash", "wax", "polish", "detailing", "clay bar",
  "tire shine", "wheel cleaner", "glass cleaner", "interior cleaner",
  "microfiber", "chamois", "drying towel",
  "oil", "motor oil", "engine oil", "transmission fluid", "brake fluid",
  "coolant", "antifreeze", "power steering fluid", "wiper fluid",
  
  // ═══════════════════════════════════════════════════════════════════════════
  // RACKS & CARRIERS
  // ═══════════════════════════════════════════════════════════════════════════
  "roof rack", "cargo rack", "bike rack", "kayak rack", "ski rack",
  "cargo carrier", "cargo box", "rooftop carrier",
  "tow hitch", "trailer hitch", "hitch", "ball mount", "hitch pin",
  "hitch cover", "receiver hitch", "tow bar",
  "bed extender", "tonneau cover", "bed cover", "bed liner", "bed mat",
  
  // ═══════════════════════════════════════════════════════════════════════════
  // PARTS INDICATORS (generic)
  // ═══════════════════════════════════════════════════════════════════════════
  "parts", "part", "accessories", "accessory", "component", "kit",
  "replacement", "repair", "remanufactured", "rebuilt", "refurbished part",
  "oem part", "aftermarket", "compatible with", "fits", "for",
  "part number", "part #", "pn:", "oe#", "oem#",
  "hardware", "mounting", "bracket", "clamp", "bolt", "screw", "nut",
  "clip", "retainer", "fastener", "grommet",
  
  // ═══════════════════════════════════════════════════════════════════════════
  // FLUIDS & CHEMICALS
  // ═══════════════════════════════════════════════════════════════════════════
  "additive", "fuel additive", "oil additive", "treatment",
  "grease", "lubricant", "penetrating oil", "wd-40",
  "adhesive", "sealant", "gasket maker", "rtv",

  // ═══════════════════════════════════════════════════════════════════════════
  // AUTOMOTIVE SHOP EQUIPMENT (garage/shop equipment - NOT vehicles)
  // ═══════════════════════════════════════════════════════════════════════════
  "automotive lift", "car lift", "vehicle lift", "two post lift", "four post lift",
  "2 post lift", "4 post lift", "scissor lift", "motorcycle lift", "atv lift",
  "alignment rack", "alignment machine", "wheel alignment", "alignment system",
  "tire changer", "tire machine", "wheel balancer", "balancing machine", "tire bead",
  "diagnostic scanner", "obd scanner", "obd2", "obdii", "code reader", "scan tool",
  "diagnostic tool", "diagnostic computer", "diagnostic kit", "diagnostic equipment",
  "engine analyzer", "compression tester", "leak down tester", "smoke tester",
  "brake lathe", "drum lathe", "rotor lathe", "disc lathe",
  "parts washer", "solvent tank", "spray booth", "paint booth", "prep station",
  "engine hoist", "engine crane", "cherry picker", "transmission jack", "floor jack",
  "shop press", "hydraulic press", "bearing press", "arbor press",
  "a/c machine", "ac machine", "refrigerant recovery", "evacuation machine", "ac recharge",
  "fluid extractor", "oil extractor", "brake bleeder", "coolant flush",
  "creeper", "mechanics creeper", "shop stool", "work bench", "workbench",
  "tool chest", "tool cabinet", "service cart", "parts cart", "tool box",
  "shop compressor", "air compressor shop", "industrial compressor",
  "sandblaster", "bead blaster", "media blaster", "abrasive blaster",
  "engine stand", "engine dolly", "transmission stand", "axle stand",
  "pipe bender", "exhaust bender", "tubing bender",
  "welder", "welding machine", "mig welder", "tig welder", "plasma cutter",
  "spring compressor", "coil compressor", "strut compressor",
  "ball joint press", "bushing press", "bearing installer",
  "headlight aimer", "headlight alignment", "alignment head",
  "smoke machine", "evap smoke", "leak detector",
  "battery tester", "battery analyzer", "load tester", "conductance tester",
  "fuel injector cleaner machine", "injector flow bench",
  "dynamometer", "dyno", "chassis dyno", "engine dyno",
  "car rotisserie", "auto rotisserie", "restoration rotisserie",
];

// ─── Auction Keywords (BLOCK for vehicles) ───────────────────────────────────
export const MOTORS_AUCTION_KEYWORDS = [
  "auction", "bid", "bidding", "reserve", "no reserve",
  "estate sale", "repo", "repossessed", "bank owned",
  "salvage", "salvage title", "rebuilt title", "flood damage",
  "for parts", "parts only", "not running", "project car",
  "needs work", "mechanic special", "fixer upper",
  "barn find", "as-is", "as is", "no warranty",
];

// ─── Valid eBay Category Paths for VEHICLES ──────────────────────────────────
// If categoryPath is available, ONLY allow these
export const VALID_VEHICLE_CATEGORY_PATHS = [
  "ebay motors > cars & trucks",
  "ebay motors > motorcycles",
  "ebay motors > powersports",
  "ebay motors > boats",
  "ebay motors > rvs & campers",
  "ebay motors > trailers",
  "ebay motors > other vehicles",
  "ebay motors > atvs",
  "vehicles > cars",
  "vehicles > trucks",
  "vehicles > motorcycles",
];

// ─── INVALID eBay Category Paths (parts/accessories) ─────────────────────────
export const INVALID_VEHICLE_CATEGORY_PATHS = [
  "parts",
  "accessories",
  "wheels",
  "tires",
  "automotive tools",
  "oils",
  "fluids",
  "safety",
  "security",
];

// ─── Filter Interface ───────────────────────────────────────────────────────

export interface MotorsFilterInput {
  title: string;
  priceUsd: number | null;
  buyingOptions?: string[];
  condition?: string;
  categoryPath?: string;
  vehiclesSubkey?: string | null;
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
 * STRICT MODE: Enforces $1500+ minimum, FIXED_PRICE only, strong keyword exclusion
 */
export function isAllowedMotorListing(input: MotorsFilterInput): MotorsFilterResult {
  const titleLower = (input.title || "").toLowerCase();
  const categoryPath = (input.categoryPath || "").toLowerCase();
  
  // Get minimum price for this vehicle subkey
  const minPrice = getMinPriceForVehicleSubkey(input.vehiclesSubkey ?? null);

  // 1. ENFORCE minimum price ($1500+ for real vehicles)
  if (input.priceUsd === null || input.priceUsd < minPrice) {
    return {
      isAllowed: false,
      reason: "price_below_minimum",
      matchedKeyword: `$${input.priceUsd ?? 0} < $${minPrice}`,
    };
  }

  // 2. Check buying options - ONLY Fixed Price/Buy It Now allowed
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

  // 4. Check category path for parts indicators (if available)
  if (categoryPath) {
    // Check if it's in an INVALID category path
    for (const invalidPath of INVALID_VEHICLE_CATEGORY_PATHS) {
      if (categoryPath.includes(invalidPath)) {
        return {
          isAllowed: false,
          reason: "category_path_parts",
          matchedKeyword: invalidPath,
        };
      }
    }
  }

  // 5. Check parts/accessories keywords in title (COMPREHENSIVE list)
  for (const keyword of MOTORS_PARTS_KEYWORDS) {
    // Use word boundary matching for short keywords to avoid false positives
    const keywordLower = keyword.toLowerCase();
    
    if (keywordLower.length <= 4) {
      // For very short keywords, require word boundaries
      const regex = new RegExp(`\\b${keywordLower.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
      if (regex.test(titleLower)) {
        return {
          isAllowed: false,
          reason: "parts_accessory",
          matchedKeyword: keyword,
        };
      }
    } else {
      // For longer keywords, substring match is fine
      if (titleLower.includes(keywordLower)) {
        return {
          isAllowed: false,
          reason: "parts_accessory",
          matchedKeyword: keyword,
        };
      }
    }
  }

  // All checks passed - this appears to be a real vehicle listing
  return {
    isAllowed: true,
    reason: null,
    matchedKeyword: null,
  };
}

/**
 * Check if an item should be classified as a PART (not vehicle)
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
  for (const invalidPath of INVALID_VEHICLE_CATEGORY_PATHS) {
    if (categoryPath.includes(invalidPath)) {
      return true;
    }
  }

  // Price below vehicle minimum indicates parts
  if (input.priceUsd !== null && input.priceUsd < VEHICLES_MIN_PRICE_USD) {
    return true;
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
 * Build eBay filter string for vehicles
 * @param subkey - vehicle subcategory
 * @param minPrice - minimum price (defaults to subkey-specific or $1500)
 */
export function buildEbayMotorsFilter(subkey?: string | null, minPrice?: number): string {
  const effectiveMinPrice = minPrice ?? getMinPriceForVehicleSubkey(subkey ?? null);
  
  // eBay Browse API filter format:
  // - FIXED_PRICE only (no auctions)
  // - Price >= $1500 (or subkey-specific minimum)
  // - New/Used conditions only
  return `buyingOptions:{FIXED_PRICE},price:[${effectiveMinPrice}..],conditionIds:{1000|1500|2000|2500|3000}`;
}

/**
 * Build eBay filter string for vehicles (alias)
 */
export function buildEbayVehiclesFilter(subkey?: string | null, minPrice?: number): string {
  return buildEbayMotorsFilter(subkey, minPrice);
}

/**
 * Seed queries for VEHICLES category (actual vehicles, not parts)
 * These should return real vehicle listings
 */
export const MOTORS_SEED_QUERIES = [
  // Actual vehicle searches
  "car for sale",
  "truck for sale",
  "suv for sale",
  "sedan for sale",
  "toyota camry",
  "honda accord",
  "honda civic",
  "ford f-150",
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
  "mazda cx-5",
  "subaru outback",
  "jeep wrangler",
  "dodge ram",
];

export const VEHICLES_SEED_QUERIES: Record<string, string[]> = {
  cars_trucks: [
    "car for sale", "truck for sale", "suv for sale", "sedan for sale",
    "pickup truck for sale", "used car buy it now", "certified pre-owned",
    "toyota camry for sale", "honda accord for sale", "ford f-150 for sale",
    "chevrolet silverado for sale", "tesla model 3 for sale",
    "bmw for sale", "mercedes for sale", "audi for sale",
  ],
  motorcycles: [
    "motorcycle for sale", "harley davidson for sale", "honda motorcycle",
    "kawasaki ninja", "yamaha motorcycle", "ducati", "triumph motorcycle",
    "indian motorcycle", "cruiser motorcycle", "sport bike",
  ],
  powersports: [
    "atv for sale", "utv for sale", "side by side", "polaris ranger",
    "can-am maverick", "rzr for sale", "snowmobile", "jet ski",
    "sea-doo", "personal watercraft", "quad for sale",
  ],
  boats: [
    "boat for sale", "fishing boat", "pontoon boat", "yacht",
    "sailboat", "speedboat", "bass boat", "cabin cruiser",
    "center console boat", "bowrider",
  ],
  rvs_campers: [
    "rv for sale", "motorhome", "travel trailer", "fifth wheel",
    "camper van", "class a motorhome", "class c motorhome",
    "toy hauler", "pop up camper",
  ],
  trailers_other: [
    "utility trailer", "cargo trailer", "enclosed trailer",
    "flatbed trailer", "dump trailer", "car hauler trailer",
    "landscape trailer", "equipment trailer",
  ],
  classic_cars: [
    "classic car for sale", "vintage car", "antique car", "muscle car",
    "collector car", "hot rod", "restored classic", "1960s car",
    "1970s muscle car", "classic corvette", "classic mustang",
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
  VALID_VEHICLE_CATEGORY_PATHS,
  INVALID_VEHICLE_CATEGORY_PATHS,
  MOTORS_SEED_QUERIES,
  VEHICLES_SEED_QUERIES,
  PARTS_SEED_QUERIES,
  isAllowedMotorListing,
  isPartsListing,
  filterMotorListings,
  buildEbayMotorsFilter,
  buildEbayVehiclesFilter,
};
