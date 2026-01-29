/**
 * Category Mapper - Unified Category & Subcategory Assignment
 * 
 * Maps items from eBay and Rainforest/Amazon to a consistent set of
 * unified categories for DB-first serving.
 * 
 * TABS list is the single source of truth for category tabs.
 * mapUnifiedCategory assigns a category based on title, provider, eBay category path, etc.
 * mapUnifiedSubcategory assigns electronics subcategories (phones, computers, audio, etc.)
 */

// ─── Unified Category Tabs ─────────────────────────────────────────────────────
// This is the single source of truth for category tabs displayed in the app

export interface CategoryTab {
  key: string;
  title: string;
  icon?: string;
  subcategories?: string[];
}

export const TABS: CategoryTab[] = [
  { 
    key: "electronics", 
    title: "Electronics", 
    icon: "📱",
    subcategories: ["phones", "computers", "audio", "monitors", "tablets", "chargers"]
  },
  { key: "motors", title: "Motors", icon: "🚗" },
  { key: "home_garden", title: "Home & Garden", icon: "🏠" },
  { key: "clothing", title: "Clothing, Shoes & Accessories", icon: "👕" },
  { key: "toys", title: "Toys", icon: "🧸" },
  { key: "sporting_goods", title: "Sporting Goods", icon: "⚽" },
  { key: "business_industrial", title: "Business & Industrial", icon: "🏭" },
  { key: "jewelry_watches", title: "Jewelry & Watches", icon: "💎" },
  { key: "refurbished", title: "Refurbished", icon: "♻️" },
];

export const VALID_CATEGORIES = new Set(TABS.map(t => t.key));

// Electronics subcategories - for sub-tab navigation
export const ELECTRONICS_SUBCATEGORIES = new Set([
  "phones", "computers", "audio", "monitors", "tablets", "chargers"
]);

// Check if a key is a subcategory of electronics
export function isElectronicsSubcategory(key: string): boolean {
  return ELECTRONICS_SUBCATEGORIES.has(key);
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

// ─── Category Detection Rules ──────────────────────────────────────────────────

// Motors keywords and eBay category patterns
const MOTORS_TITLE_KEYWORDS = [
  "car", "vehicle", "truck", "suv", "sedan", "coupe", "convertible",
  "toyota", "honda", "ford", "bmw", "mercedes", "chevrolet", "nissan",
  "lexus", "audi", "volkswagen", "hyundai", "kia", "mazda", "subaru",
  "jeep", "dodge", "ram", "gmc", "cadillac", "lincoln", "tesla",
  "porsche", "ferrari", "lamborghini", "maserati", "jaguar", "land rover",
  "motorcycle", "atv", "boat", "rv", "trailer",
];

const MOTORS_PATH_PATTERNS = ["motors", "vehicles", "cars & trucks", "motorcycles", "boats"];

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
 * Returns null if no clear subcategory match.
 */
export function mapUnifiedSubcategory(title: string): string | null {
  const lowerTitle = title.toLowerCase();
  
  // Check phones first (common)
  for (const keyword of PHONES_KEYWORDS) {
    if (lowerTitle.includes(keyword)) return "phones";
  }
  
  // Check computers
  for (const keyword of COMPUTERS_KEYWORDS) {
    if (lowerTitle.includes(keyword)) return "computers";
  }
  
  // Check audio
  for (const keyword of AUDIO_KEYWORDS) {
    if (lowerTitle.includes(keyword)) return "audio";
  }
  
  // Check monitors
  for (const keyword of MONITORS_KEYWORDS) {
    if (lowerTitle.includes(keyword)) return "monitors";
  }
  
  // Check tablets
  for (const keyword of TABLETS_KEYWORDS) {
    if (lowerTitle.includes(keyword)) return "tablets";
  }
  
  // Check chargers
  for (const keyword of CHARGERS_KEYWORDS) {
    if (lowerTitle.includes(keyword)) return "chargers";
  }
  
  return null;
}

// ─── Main Category Mapper ──────────────────────────────────────────────────────

export interface CategoryMapperInput {
  title?: string;
  provider?: string;
  ebayCategoryPath?: string;
  ebayCategoryId?: string;
  productUrl?: string;
  condition?: string;
}

export interface CategoryMapperResult {
  category: string;
  subcategory: string | null;
}

/**
 * Map an item to a unified category.
 * Returns "blocked" if item should not be stored/returned.
 * Returns one of the TABS keys otherwise.
 */
export function mapUnifiedCategory(input: CategoryMapperInput): string {
  const title = (input.title || "").toLowerCase();
  const path = (input.ebayCategoryPath || "").toLowerCase();
  const url = (input.productUrl || "").toLowerCase();
  const condition = (input.condition || "").toLowerCase();

  // 1. HARD BLOCK - never show these
  for (const keyword of BLOCKED_KEYWORDS) {
    if (keyword.length <= 4) {
      // Word boundary for short keywords
      const regex = new RegExp(`\\b${escapeRegex(keyword)}\\b`, "i");
      if (regex.test(title)) return "blocked";
    } else {
      if (title.includes(keyword)) return "blocked";
    }
    // Also check URL
    if (url.includes(keyword.replace(/\s+/g, ""))) return "blocked";
  }

  // 2. Check for REFURBISHED first (can apply to any category)
  for (const keyword of REFURBISHED_KEYWORDS) {
    if (title.includes(keyword) || condition.includes(keyword) || path.includes(keyword)) {
      return "refurbished";
    }
  }

  // 3. Check MOTORS (high priority for AfriShop's vehicle focus)
  for (const keyword of MOTORS_TITLE_KEYWORDS) {
    if (title.includes(keyword)) return "motors";
  }
  for (const pattern of MOTORS_PATH_PATTERNS) {
    if (path.includes(pattern)) return "motors";
  }

  // 4. Check ELECTRONICS
  for (const keyword of ELECTRONICS_KEYWORDS) {
    if (title.includes(keyword)) return "electronics";
  }
  if (path.includes("electronics") || path.includes("cell phones") || path.includes("computers")) {
    return "electronics";
  }

  // 5. Check CLOTHING
  for (const keyword of CLOTHING_KEYWORDS) {
    if (title.includes(keyword)) return "clothing";
  }
  if (path.includes("clothing") || path.includes("shoes") || path.includes("accessories") || path.includes("fashion")) {
    return "clothing";
  }

  // 6. Check HOME & GARDEN
  for (const keyword of HOME_GARDEN_KEYWORDS) {
    if (title.includes(keyword)) return "home_garden";
  }
  if (path.includes("home") || path.includes("garden") || path.includes("kitchen") || path.includes("furniture")) {
    return "home_garden";
  }

  // 7. Check TOYS
  for (const keyword of TOYS_KEYWORDS) {
    if (title.includes(keyword)) return "toys";
  }
  if (path.includes("toys") || path.includes("games")) {
    return "toys";
  }

  // 8. Check SPORTING GOODS
  for (const keyword of SPORTING_GOODS_KEYWORDS) {
    if (title.includes(keyword)) return "sporting_goods";
  }
  if (path.includes("sport") || path.includes("outdoor") || path.includes("fitness")) {
    return "sporting_goods";
  }

  // 9. Check BUSINESS & INDUSTRIAL
  for (const keyword of BUSINESS_INDUSTRIAL_KEYWORDS) {
    if (title.includes(keyword)) return "business_industrial";
  }
  if (path.includes("business") || path.includes("industrial")) {
    return "business_industrial";
  }

  // 10. Check JEWELRY & WATCHES
  for (const keyword of JEWELRY_WATCHES_KEYWORDS) {
    if (title.includes(keyword)) return "jewelry_watches";
  }
  if (path.includes("jewelry") || path.includes("watches")) {
    return "jewelry_watches";
  }

  // 11. Default to electronics (AfriShop's main focus)
  return "electronics";
}

/**
 * Map an item to both category and subcategory
 */
export function mapCategoryAndSubcategory(input: CategoryMapperInput): CategoryMapperResult {
  const category = mapUnifiedCategory(input);
  
  // Only compute subcategory for electronics
  let subcategory: string | null = null;
  if (category === "electronics" && input.title) {
    subcategory = mapUnifiedSubcategory(input.title);
  }
  
  return { category, subcategory };
}

/**
 * Check if a category key is valid (main category or electronics subcategory)
 */
export function isValidCategory(category: string): boolean {
  return VALID_CATEGORIES.has(category) || ELECTRONICS_SUBCATEGORIES.has(category);
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
  const subcategoryTitles: Record<string, string> = {
    phones: "Phones",
    computers: "Computers",
    audio: "Audio",
    monitors: "Monitors",
    tablets: "Tablets",
    chargers: "Chargers",
  };
  
  return subcategoryTitles[key] || key;
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
  mapUnifiedCategory,
  mapUnifiedSubcategory,
  mapCategoryAndSubcategory,
  isValidCategory,
  isMainCategory,
  isElectronicsSubcategory,
  getCategoryTitle,
};
