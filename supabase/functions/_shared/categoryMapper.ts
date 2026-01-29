/**
 * Category Mapper - Unified Category Assignment
 * 
 * Maps items from eBay and Rainforest/Amazon to a consistent set of
 * unified categories for DB-first serving.
 * 
 * TABS list is the single source of truth for category tabs.
 * mapUnifiedCategory assigns a category based on title, provider, eBay category path, etc.
 */

// ─── Unified Category Tabs ─────────────────────────────────────────────────────
// This is the single source of truth for category tabs displayed in the app

export interface CategoryTab {
  key: string;
  title: string;
  icon?: string;
}

export const TABS: CategoryTab[] = [
  { key: "electronics", title: "Electronics", icon: "📱" },
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

// Electronics keywords
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

// ─── Main Category Mapper ──────────────────────────────────────────────────────

export interface CategoryMapperInput {
  title?: string;
  provider?: string;
  ebayCategoryPath?: string;
  ebayCategoryId?: string;
  productUrl?: string;
  condition?: string;
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
 * Check if a category key is valid
 */
export function isValidCategory(category: string): boolean {
  return VALID_CATEGORIES.has(category);
}

/**
 * Get category title by key
 */
export function getCategoryTitle(key: string): string {
  const tab = TABS.find(t => t.key === key);
  return tab?.title || key;
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
  mapUnifiedCategory,
  isValidCategory,
  getCategoryTitle,
};
