/**
 * Category Mapper - Unified Category & Subcategory Assignment
 * 
 * AfriShop Backend-Driven Category System
 * 
 * TOP-LEVEL TABS (in order):
 * - electronics
 * - vehicles (NEW - top-level, for actual vehicles ONLY)
 * - home_garden
 * - clothing_shoes_accessories
 * - toys
 * - sporting_goods
 * - business_industrial
 * - jewelry_watches
 * - refurbished
 * - parts_accessories (for automotive parts, NOT vehicles)
 * 
 * REMOVED:
 * - "motors" as top-level (now split into "vehicles" and "parts_accessories")
 * - "secure_purchase" (completely removed)
 */

// ─── Vehicles Subcategories ─────────────────────────────────────────────────
export const VEHICLES_SUBCATEGORIES = [
  { key: "cars_trucks", title: "Cars & Trucks", icon: "car" },
  { key: "motorcycles", title: "Motorcycles", icon: "bike" },
  { key: "powersports", title: "Powersports", icon: "zap" },
  { key: "boats", title: "Boats", icon: "ship" },
  { key: "rvs_campers", title: "RVs & Campers", icon: "caravan" },
  { key: "trailers_other", title: "Trailers & Other", icon: "truck" },
  { key: "classic_cars", title: "Classic Cars", icon: "star" },
];

export const VEHICLES_SUBKEYS = new Set(VEHICLES_SUBCATEGORIES.map(s => s.key));

// ─── Parts & Accessories Subcategories ──────────────────────────────────────
export const PARTS_SUBCATEGORIES = [
  { key: "all_parts", title: "All Parts", icon: "wrench" },
  { key: "car_truck_parts", title: "Car & Truck Parts", icon: "settings" },
  { key: "wheels_tires", title: "Wheels & Tires", icon: "circle" },
  { key: "moto_scooter_parts", title: "Motorcycle & Scooter Parts", icon: "bike" },
  { key: "atv_utv_parts", title: "ATV & UTV Parts", icon: "truck" },
  { key: "tools_supplies", title: "Tools & Supplies", icon: "hammer" },
  { key: "diy_guides", title: "DIY Guides", icon: "book-open", enabled: false },
  { key: "my_garage", title: "My Garage", icon: "garage", enabled: false },
];

export const PARTS_SUBKEYS = new Set(PARTS_SUBCATEGORIES.map(s => s.key));

// ─── Electronics Subcategories ──────────────────────────────────────────────
export const ELECTRONICS_SUBCATEGORIES_LIST = [
  { key: "phones", title: "Phones", icon: "smartphone" },
  { key: "computers", title: "Computers", icon: "laptop" },
  { key: "audio", title: "Audio", icon: "headphones" },
  { key: "monitors", title: "Monitors", icon: "monitor" },
  { key: "tablets", title: "Tablets", icon: "tablet" },
  { key: "chargers", title: "Chargers", icon: "battery-charging" },
];

export const ELECTRONICS_SUBCATEGORIES = new Set(ELECTRONICS_SUBCATEGORIES_LIST.map(s => s.key));

// ─── Unified Category Tabs ─────────────────────────────────────────────────────

export interface CategoryTab {
  key: string;
  title: string;
  icon?: string;
  providerPriority?: string[];
  allowLive?: boolean;
  subcategories?: { key: string; title: string; icon?: string; enabled?: boolean }[];
  listingType?: "vehicle" | "part";
}

// The 10 unified category tabs (VEHICLES is now top-level, MOTORS removed)
export const TABS: CategoryTab[] = [
  { 
    key: "electronics", 
    title: "Electronics", 
    icon: "bolt",
    providerPriority: ["ebay", "rainforest"],
    allowLive: true,
    subcategories: ELECTRONICS_SUBCATEGORIES_LIST,
  },
  { 
    key: "vehicles", 
    title: "Vehicles", 
    icon: "car",
    providerPriority: ["ebay"],
    allowLive: true,
    listingType: "vehicle",
    subcategories: VEHICLES_SUBCATEGORIES,
  },
  { 
    key: "home_garden", 
    title: "Home & Garden", 
    icon: "home",
    providerPriority: ["ebay"],
    allowLive: true,
  },
  { 
    key: "clothing_shoes_accessories", 
    title: "Clothing, Shoes & Accessories", 
    icon: "shirt",
    providerPriority: ["ebay"],
    allowLive: true,
  },
  { 
    key: "toys", 
    title: "Toys", 
    icon: "puzzle",
    providerPriority: ["ebay"],
    allowLive: true,
  },
  { 
    key: "sporting_goods", 
    title: "Sporting Goods", 
    icon: "dumbbell",
    providerPriority: ["ebay"],
    allowLive: true,
  },
  { 
    key: "business_industrial", 
    title: "Business & Industrial", 
    icon: "factory",
    providerPriority: ["ebay"],
    allowLive: true,
  },
  { 
    key: "jewelry_watches", 
    title: "Jewelry & Watches", 
    icon: "watch",
    providerPriority: ["ebay"],
    allowLive: true,
  },
  { 
    key: "refurbished", 
    title: "Refurbished", 
    icon: "refresh-ccw",
    providerPriority: ["ebay"],
    allowLive: true,
  },
  { 
    key: "parts_accessories", 
    title: "Parts & Accessories", 
    icon: "wrench",
    providerPriority: ["ebay"],
    allowLive: true,
    listingType: "part",
    subcategories: PARTS_SUBCATEGORIES,
  },
];

export const VALID_CATEGORIES = new Set(TABS.map(t => t.key));

// Category aliases - maps alternate keys to canonical keys
// NOTE: "motors" now maps to "vehicles" since we split motors into vehicles + parts
export const CATEGORY_ALIASES: Record<string, string> = {
  "motors": "vehicles",
  "cars": "vehicles",
  "cars_trucks": "vehicles",
  "motorcycles": "vehicles",
  "boats": "vehicles",
  "clothing": "clothing_shoes_accessories",
  "fashion": "clothing_shoes_accessories",
  "home": "home_garden",
  "garden": "home_garden",
  "jewelry": "jewelry_watches",
  "watches": "jewelry_watches",
  "industrial": "business_industrial",
  "business": "business_industrial",
  "sports": "sporting_goods",
  "parts": "parts_accessories",
  "accessories": "parts_accessories",
  "auto_parts": "parts_accessories",
};

// Resolve category alias to canonical key
export function resolveCategory(key: string): string {
  const lower = key.toLowerCase();
  return CATEGORY_ALIASES[lower] || lower;
}

// Check if a key is a subcategory of electronics
export function isElectronicsSubcategory(key: string): boolean {
  return ELECTRONICS_SUBCATEGORIES.has(key);
}

// Check if a key is a vehicles subcategory
export function isVehiclesSubcategory(key: string): boolean {
  return VEHICLES_SUBKEYS.has(key);
}

// Check if a key is a parts subcategory
export function isPartsSubcategory(key: string): boolean {
  return PARTS_SUBKEYS.has(key);
}

// ─── Blocked Keywords (Hard Block) ─────────────────────────────────────────────
// Items matching these are NEVER shown - returns "blocked"

const BLOCKED_KEYWORDS = [
  "kindle", "audible", "ebook", "e-book", "book", "books",
  "prime video", "video subscription", "subscription", "subscriptions",
  "magazine", "magazines", "audiobook", "audiobooks",
  "paperback", "hardcover", "textbook", "novel", "novels",
  "comics", "manga", "journal", "journals",
  "streaming", "membership", "unlimited", "digital download",
  "secure purchase", // Removed from catalog entirely
];

// ─── Auction Keywords (Block for vehicles) ──────────────────────────────────
const AUCTION_KEYWORDS = [
  "auction", "bid", "bidding", "reserve", "no reserve",
];

// ─── Electronics Subcategory Keywords ───────────────────────────────────────────

const PHONES_KEYWORDS = [
  "iphone", "samsung galaxy", "pixel phone", "smartphone", "unlocked phone",
  "cell phone", "mobile phone", "android phone", "5g phone", "refurbished iphone",
  "phone 15", "phone 14", "phone 13", "galaxy s", "galaxy z", "oneplus", "motorola",
];

const COMPUTERS_KEYWORDS = [
  "laptop", "macbook", "notebook", "desktop", "pc computer", "chromebook",
  "gaming laptop", "ultrabook", "workstation", "imac", "mac mini", "mac studio",
  "dell xps", "thinkpad", "surface laptop", "hp pavilion", "asus rog",
  "gaming pc", "all-in-one computer", "mini pc",
];

const AUDIO_KEYWORDS = [
  "headphones", "earbuds", "airpods", "speaker", "soundbar", "bluetooth speaker",
  "wireless earbuds", "noise cancelling", "over-ear", "in-ear", "beats",
  "bose", "sony wh", "sennheiser", "jbl", "audio system", "home theater",
  "subwoofer", "amplifier", "receiver", "dac",
];

const MONITORS_KEYWORDS = [
  "monitor", "display", "ultrawide", "gaming monitor", "curved monitor",
  "4k monitor", "27 inch", "32 inch", "led monitor", "ips display",
  "computer monitor", "lg ultragear", "samsung odyssey", "asus rog monitor",
];

const TABLETS_KEYWORDS = [
  "ipad", "tablet", "galaxy tab", "surface pro", "surface go",
  "android tablet", "fire tablet", "wacom", "drawing tablet",
  "ipad pro", "ipad air", "ipad mini", "samsung tab",
];

const CHARGERS_KEYWORDS = [
  "charger", "charging", "usb-c", "lightning cable", "magsafe", "adapter",
  "power bank", "wireless charger", "fast charger", "wall charger",
  "car charger", "charging station", "usb hub", "docking station",
  "power adapter", "laptop charger", "phone charger",
];

// ─── Vehicle Detection Keywords ─────────────────────────────────────────────

const VEHICLE_KEYWORDS = [
  // Must be actual vehicles, not parts
  "sedan", "coupe", "convertible", "hatchback", "suv", "crossover",
  "pickup truck", "minivan", "wagon", "roadster",
  // Vehicle types
  "motorcycle", "motorbike", "scooter", "moped",
  "boat", "yacht", "jet ski", "personal watercraft", "pontoon",
  "rv", "recreational vehicle", "camper", "motorhome", "travel trailer",
  "trailer", "utility trailer", "cargo trailer", "enclosed trailer",
  "atv", "utv", "quad", "side by side", "dune buggy", "golf cart",
  "snowmobile", "jet boat", "fishing boat",
  // Classic/collector
  "classic car", "antique car", "vintage car", "collector car", "muscle car",
];

// Keywords that indicate a PART, not a vehicle
const PARTS_INDICATOR_KEYWORDS = [
  "wheel", "wheels", "tire", "tires", "rim", "rims",
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
  "oil filter", "air filter", "fuel filter", "cabin filter",
  "battery", "headlight", "tail light", "brake light", "fog light",
  "turn signal", "bulb", "led light", "hid light",
  "wiper", "wiper blade", "wiper motor",
  "seat cover", "floor mat", "car mat", "cargo mat", "trunk liner",
  "car cover", "bumper", "fender", "hood", "trunk lid",
  "spoiler", "body kit", "side skirt", "mud flap", "splash guard",
  "phone mount", "dash cam", "dashcam", "backup camera",
  "gps", "car charger", "usb charger", "air freshener",
  "replacement", "repair", "remanufactured", "rebuilt",
  "oem part", "aftermarket", "compatible with", "fits",
  "part number", "part #", "pn:", "oe#",
  "parts", "accessories", "accessory", "component", "kit",
];

// ─── Category Detection Rules ──────────────────────────────────────────────────

// Brand keywords that indicate vehicles
const VEHICLE_BRAND_KEYWORDS = [
  "toyota", "honda", "ford", "bmw", "mercedes", "chevrolet", "nissan",
  "lexus", "audi", "volkswagen", "hyundai", "kia", "mazda", "subaru",
  "jeep", "dodge", "ram", "gmc", "cadillac", "lincoln", "tesla",
  "porsche", "ferrari", "lamborghini", "maserati", "jaguar", "land rover",
  "harley davidson", "kawasaki", "yamaha", "suzuki", "ducati",
  "sea-doo", "polaris", "can-am", "arctic cat",
];

// Electronics keywords (general)
const ELECTRONICS_KEYWORDS = [
  "iphone", "samsung", "laptop", "macbook", "monitor", "headset", "headphones",
  "earbuds", "airpods", "tablet", "ipad", "charger", "camera", "ps5", "xbox",
  "playstation", "nintendo", "switch", "gaming", "gpu", "graphics card",
  "computer", "pc", "desktop", "keyboard", "mouse", "speaker", "bluetooth",
  "wireless", "smart tv", "television", "drone", "gopro", "dji", "phone",
  "smartphone", "android", "pixel", "galaxy", "apple watch", "smartwatch",
  "router", "modem", "printer", "scanner", "projector", "vr", "oculus",
];

// Clothing keywords
const CLOTHING_KEYWORDS = [
  "shirt", "t-shirt", "tshirt", "hoodie", "shoes", "sneakers", "dress",
  "jacket", "pants", "jeans", "bag", "handbag", "purse", "backpack",
  "watch band", "belt", "hat", "cap", "sunglasses", "glasses",
  "coat", "sweater", "blouse", "skirt", "shorts", "socks", "underwear",
  "swimsuit", "bikini", "boots", "sandals", "heels", "loafers",
  "athletic wear", "sportswear", "leggings", "yoga pants",
];

// Home & Garden keywords
const HOME_GARDEN_KEYWORDS = [
  "vacuum", "sofa", "couch", "chair", "table", "bed", "mattress",
  "kitchen", "blender", "microwave", "air fryer", "tool", "drill",
  "furniture", "lamp", "lighting", "curtain", "rug", "carpet",
  "garden", "lawn", "patio", "grill", "bbq", "outdoor",
  "appliance", "refrigerator", "washer", "dryer", "dishwasher",
  "cookware", "bedding", "pillow", "blanket", "towel", "decor",
];

// Toys keywords
const TOYS_KEYWORDS = [
  "lego", "doll", "dolls", "puzzle", "toy", "toys", "action figure",
  "board game", "card game", "plush", "stuffed animal", "nerf",
  "barbie", "hot wheels", "playset", "building blocks", "rc car",
  "remote control", "kids", "children", "baby toy",
];

// Sporting goods keywords
const SPORTING_GOODS_KEYWORDS = [
  "soccer", "basketball", "tennis", "golf", "gym", "dumbbell", "weights",
  "bike", "bicycle", "cycling", "running", "hiking", "camping", "fishing",
  "hunting", "skiing", "snowboard", "surfing", "skateboard", "fitness",
  "yoga", "exercise", "workout", "treadmill", "elliptical", "baseball",
  "football", "hockey", "swimming", "sports", "athletic",
];

// Business & Industrial keywords
const BUSINESS_INDUSTRIAL_KEYWORDS = [
  "compressor", "generator", "forklift", "welding", "cnc", "industrial",
  "commercial", "warehouse", "pallet", "conveyor", "heavy equipment",
  "construction", "manufacturing", "office equipment", "printer",
  "copier", "shredder", "safe", "security", "surveillance",
];

// Jewelry & Watches keywords
const JEWELRY_WATCHES_KEYWORDS = [
  "ring", "necklace", "bracelet", "earrings", "earring", "watch", "watches",
  "rolex", "omega", "seiko", "casio", "diamond", "gold", "silver",
  "platinum", "pendant", "chain", "brooch", "anklet", "jewelry",
  "jewellery", "gemstone", "pearl", "luxury watch",
];

// Refurbished keywords
const REFURBISHED_KEYWORDS = [
  "renewed", "refurb", "refurbished", "certified refurbished",
  "pre-owned certified", "factory refurbished", "renewed premium",
];

// ─── Subcategory Mapper ────────────────────────────────────────────────────────

/**
 * Map electronics item to a subcategory based on title keywords.
 */
export function mapUnifiedSubcategory(title: string): string | null {
  const lowerTitle = title.toLowerCase();
  
  for (const keyword of PHONES_KEYWORDS) {
    if (lowerTitle.includes(keyword)) return "phones";
  }
  for (const keyword of COMPUTERS_KEYWORDS) {
    if (lowerTitle.includes(keyword)) return "computers";
  }
  for (const keyword of AUDIO_KEYWORDS) {
    if (lowerTitle.includes(keyword)) return "audio";
  }
  for (const keyword of MONITORS_KEYWORDS) {
    if (lowerTitle.includes(keyword)) return "monitors";
  }
  for (const keyword of TABLETS_KEYWORDS) {
    if (lowerTitle.includes(keyword)) return "tablets";
  }
  for (const keyword of CHARGERS_KEYWORDS) {
    if (lowerTitle.includes(keyword)) return "chargers";
  }
  
  return null;
}

/**
 * Map vehicle item to a subcategory based on title keywords.
 */
export function mapVehiclesSubcategory(title: string): string {
  const lowerTitle = title.toLowerCase();
  
  // Motorcycles
  if (lowerTitle.includes("motorcycle") || lowerTitle.includes("motorbike") || 
      lowerTitle.includes("harley") || lowerTitle.includes("kawasaki") ||
      lowerTitle.includes("ducati") || lowerTitle.includes("yamaha motor")) {
    return "motorcycles";
  }
  
  // Boats
  if (lowerTitle.includes("boat") || lowerTitle.includes("yacht") || 
      lowerTitle.includes("jet ski") || lowerTitle.includes("pontoon") ||
      lowerTitle.includes("watercraft") || lowerTitle.includes("sea-doo")) {
    return "boats";
  }
  
  // RVs & Campers
  if (lowerTitle.includes("rv") || lowerTitle.includes("camper") || 
      lowerTitle.includes("motorhome") || lowerTitle.includes("recreational vehicle") ||
      lowerTitle.includes("travel trailer")) {
    return "rvs_campers";
  }
  
  // Powersports (ATV, UTV, snowmobile, etc.)
  if (lowerTitle.includes("atv") || lowerTitle.includes("utv") || 
      lowerTitle.includes("quad") || lowerTitle.includes("side by side") ||
      lowerTitle.includes("snowmobile") || lowerTitle.includes("polaris") ||
      lowerTitle.includes("can-am") || lowerTitle.includes("arctic cat")) {
    return "powersports";
  }
  
  // Trailers
  if (lowerTitle.includes("trailer") && !lowerTitle.includes("travel trailer")) {
    return "trailers_other";
  }
  
  // Classic Cars
  if (lowerTitle.includes("classic") || lowerTitle.includes("antique") || 
      lowerTitle.includes("vintage") || lowerTitle.includes("collector") ||
      lowerTitle.includes("muscle car")) {
    return "classic_cars";
  }
  
  // Default to cars & trucks
  return "cars_trucks";
}

/**
 * Map parts item to a subcategory based on title keywords.
 */
export function mapPartsSubcategory(title: string): string {
  const lowerTitle = title.toLowerCase();
  
  // Wheels & Tires
  if (lowerTitle.includes("wheel") || lowerTitle.includes("tire") || 
      lowerTitle.includes("rim") || lowerTitle.includes("hubcap")) {
    return "wheels_tires";
  }
  
  // Motorcycle & Scooter Parts
  if (lowerTitle.includes("motorcycle") || lowerTitle.includes("scooter") || 
      lowerTitle.includes("motorbike") || lowerTitle.includes("harley part")) {
    return "moto_scooter_parts";
  }
  
  // ATV & UTV Parts
  if (lowerTitle.includes("atv") || lowerTitle.includes("utv") || 
      lowerTitle.includes("quad part") || lowerTitle.includes("side by side")) {
    return "atv_utv_parts";
  }
  
  // Tools & Supplies
  if (lowerTitle.includes("tool") || lowerTitle.includes("wrench") || 
      lowerTitle.includes("socket") || lowerTitle.includes("jack") ||
      lowerTitle.includes("oil") || lowerTitle.includes("fluid") ||
      lowerTitle.includes("cleaner") || lowerTitle.includes("polish")) {
    return "tools_supplies";
  }
  
  // Default to car/truck parts
  return "car_truck_parts";
}

// ─── Main Category Mapper ──────────────────────────────────────────────────────

export interface CategoryMapperInput {
  title?: string;
  provider?: string;
  ebayCategoryPath?: string;
  ebayCategoryId?: string;
  productUrl?: string;
  condition?: string;
  priceUsd?: number | null;
  buyingOptions?: string[];
}

export interface CategoryMapperResult {
  category: string;
  subcategory: string | null;
  listingType: "vehicle" | "part" | null;
  vehiclesSubkey: string | null;
  partsSubkey: string | null;
}

/**
 * Detect if an item is a vehicle (not a part)
 */
export function isVehicleListing(input: CategoryMapperInput): boolean {
  const title = (input.title || "").toLowerCase();
  const path = (input.ebayCategoryPath || "").toLowerCase();
  const priceUsd = input.priceUsd || 0;
  
  // Must meet minimum price for vehicles ($1500)
  if (priceUsd < 1500) return false;
  
  // Check for parts indicators first (if has parts keywords, NOT a vehicle)
  for (const keyword of PARTS_INDICATOR_KEYWORDS) {
    if (title.includes(keyword.toLowerCase())) return false;
  }
  
  // Check for auction keywords (vehicles must be Buy It Now only)
  for (const keyword of AUCTION_KEYWORDS) {
    if (title.includes(keyword.toLowerCase())) return false;
  }
  
  // Check if buying options indicate auction
  if (input.buyingOptions && input.buyingOptions.length > 0) {
    const hasFixedPrice = input.buyingOptions.some(opt => 
      opt.toUpperCase().includes("FIXED_PRICE") || 
      opt.toUpperCase().includes("BUY_IT_NOW") ||
      opt.toUpperCase().includes("BEST_OFFER")
    );
    if (!hasFixedPrice) return false;
  }
  
  // Check for vehicle keywords
  for (const keyword of VEHICLE_KEYWORDS) {
    if (title.includes(keyword.toLowerCase())) return true;
  }
  
  // Check for brand + vehicle context
  for (const brand of VEHICLE_BRAND_KEYWORDS) {
    if (title.includes(brand.toLowerCase())) {
      // Brand alone isn't enough - check for vehicle context
      if (title.includes("car") || title.includes("suv") || 
          title.includes("truck") || title.includes("sedan") ||
          title.includes("coupe") || title.includes("convertible") ||
          path.includes("motors") || path.includes("vehicles")) {
        return true;
      }
    }
  }
  
  // Check category path
  if (path.includes("ebay motors") || path.includes("cars & trucks") ||
      path.includes("motorcycles") || path.includes("boats") ||
      path.includes("powersports") || path.includes("rvs & campers")) {
    // But not if it's parts
    if (!path.includes("parts") && !path.includes("accessories")) {
      return true;
    }
  }
  
  return false;
}

/**
 * Map an item to a unified category.
 * Returns "blocked" if item should not be stored/returned.
 */
export function mapUnifiedCategory(input: CategoryMapperInput): string {
  const title = (input.title || "").toLowerCase();
  const path = (input.ebayCategoryPath || "").toLowerCase();
  const url = (input.productUrl || "").toLowerCase();
  const condition = (input.condition || "").toLowerCase();

  // 1. HARD BLOCK - never show these
  for (const keyword of BLOCKED_KEYWORDS) {
    if (keyword.length <= 4) {
      const regex = new RegExp(`\\b${escapeRegex(keyword)}\\b`, "i");
      if (regex.test(title)) return "blocked";
    } else {
      if (title.includes(keyword)) return "blocked";
    }
    if (url.includes(keyword.replace(/\s+/g, ""))) return "blocked";
  }

  // 2. Check for REFURBISHED first (can apply to any category)
  for (const keyword of REFURBISHED_KEYWORDS) {
    if (title.includes(keyword) || condition.includes(keyword) || path.includes(keyword)) {
      return "refurbished";
    }
  }

  // 3. Check if it's a VEHICLE (high priority for AfriShop)
  if (isVehicleListing(input)) {
    return "vehicles";
  }

  // 4. Check if it's automotive PARTS (motors path but not vehicle)
  if (path.includes("motors") || path.includes("auto parts") || path.includes("car parts")) {
    // Check for parts indicators
    for (const keyword of PARTS_INDICATOR_KEYWORDS) {
      if (title.includes(keyword.toLowerCase())) {
        return "parts_accessories";
      }
    }
  }

  // 5. Check ELECTRONICS
  for (const keyword of ELECTRONICS_KEYWORDS) {
    if (title.includes(keyword)) return "electronics";
  }
  if (path.includes("electronics") || path.includes("cell phones") || path.includes("computers")) {
    return "electronics";
  }

  // 6. Check CLOTHING
  for (const keyword of CLOTHING_KEYWORDS) {
    if (title.includes(keyword)) return "clothing_shoes_accessories";
  }
  if (path.includes("clothing") || path.includes("shoes") || path.includes("accessories") || path.includes("fashion")) {
    return "clothing_shoes_accessories";
  }

  // 7. Check HOME & GARDEN
  for (const keyword of HOME_GARDEN_KEYWORDS) {
    if (title.includes(keyword)) return "home_garden";
  }
  if (path.includes("home") || path.includes("garden") || path.includes("kitchen") || path.includes("furniture")) {
    return "home_garden";
  }

  // 8. Check TOYS
  for (const keyword of TOYS_KEYWORDS) {
    if (title.includes(keyword)) return "toys";
  }
  if (path.includes("toys") || path.includes("games")) {
    return "toys";
  }

  // 9. Check SPORTING GOODS
  for (const keyword of SPORTING_GOODS_KEYWORDS) {
    if (title.includes(keyword)) return "sporting_goods";
  }
  if (path.includes("sport") || path.includes("outdoor") || path.includes("fitness")) {
    return "sporting_goods";
  }

  // 10. Check BUSINESS & INDUSTRIAL
  for (const keyword of BUSINESS_INDUSTRIAL_KEYWORDS) {
    if (title.includes(keyword)) return "business_industrial";
  }
  if (path.includes("business") || path.includes("industrial")) {
    return "business_industrial";
  }

  // 11. Check JEWELRY & WATCHES
  for (const keyword of JEWELRY_WATCHES_KEYWORDS) {
    if (title.includes(keyword)) return "jewelry_watches";
  }
  if (path.includes("jewelry") || path.includes("watches")) {
    return "jewelry_watches";
  }

  // 12. Default to electronics (AfriShop's main focus)
  return "electronics";
}

/**
 * Map an item to category, subcategory, and listing type
 */
export function mapCategoryAndSubcategory(input: CategoryMapperInput): CategoryMapperResult {
  const category = mapUnifiedCategory(input);
  
  let subcategory: string | null = null;
  let listingType: "vehicle" | "part" | null = null;
  let vehiclesSubkey: string | null = null;
  let partsSubkey: string | null = null;
  
  if (category === "electronics" && input.title) {
    subcategory = mapUnifiedSubcategory(input.title);
  } else if (category === "vehicles" && input.title) {
    listingType = "vehicle";
    vehiclesSubkey = mapVehiclesSubcategory(input.title);
    subcategory = vehiclesSubkey;
  } else if (category === "parts_accessories" && input.title) {
    listingType = "part";
    partsSubkey = mapPartsSubcategory(input.title);
    subcategory = partsSubkey;
  }
  
  return { category, subcategory, listingType, vehiclesSubkey, partsSubkey };
}

/**
 * Check if a category key is valid (main category or subcategory)
 */
export function isValidCategory(category: string): boolean {
  return VALID_CATEGORIES.has(category) || 
         ELECTRONICS_SUBCATEGORIES.has(category) ||
         VEHICLES_SUBKEYS.has(category) ||
         PARTS_SUBKEYS.has(category);
}

/**
 * Check if key is a main category (not subcategory)
 */
export function isMainCategory(key: string): boolean {
  return VALID_CATEGORIES.has(key);
}

/**
 * Get category title by key
 */
export function getCategoryTitle(key: string): string {
  const tab = TABS.find(t => t.key === key);
  if (tab) return tab.title;
  
  // Check subcategories
  const vehicleSub = VEHICLES_SUBCATEGORIES.find(s => s.key === key);
  if (vehicleSub) return vehicleSub.title;
  
  const partsSub = PARTS_SUBCATEGORIES.find(s => s.key === key);
  if (partsSub) return partsSub.title;
  
  const electronicsSub = ELECTRONICS_SUBCATEGORIES_LIST.find(s => s.key === key);
  if (electronicsSub) return electronicsSub.title;
  
  return key;
}

/**
 * Escape regex special characters
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export default {
  TABS,
  VALID_CATEGORIES,
  ELECTRONICS_SUBCATEGORIES,
  VEHICLES_SUBCATEGORIES,
  VEHICLES_SUBKEYS,
  PARTS_SUBCATEGORIES,
  PARTS_SUBKEYS,
  CATEGORY_ALIASES,
  resolveCategory,
  mapUnifiedCategory,
  mapUnifiedSubcategory,
  mapVehiclesSubcategory,
  mapPartsSubcategory,
  mapCategoryAndSubcategory,
  isValidCategory,
  isMainCategory,
  isElectronicsSubcategory,
  isVehiclesSubcategory,
  isPartsSubcategory,
  isVehicleListing,
  getCategoryTitle,
};
