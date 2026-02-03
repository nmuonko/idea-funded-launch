/**
 * Content Blocker - Hard Block for Books, Subscriptions, Prime Video
 * 
 * AfriShop MUST NEVER show books, subscriptions, streaming, Prime Video,
 * Kindle, Audible, magazines, ebooks — anywhere in the catalog.
 * 
 * This is a strict business rule applied globally.
 */

// ==================== BLOCKED KEYWORDS ====================
// Applied to: title, URL, tags, category (case-insensitive)
const BLOCKED_KEYWORDS = new Set([
  // Books & Reading
  "kindle",
  "audible",
  "ebook",
  "e-book",
  "book",
  "books",
  "paperback",
  "hardcover",
  "audiobook",
  "magazine",
  "magazines",
  "journal",
  "journals",
  "novel",
  "novels",
  "comics",
  "manga",
  "puzzle book",
  "coloring book",
  "textbook",
  "textbooks",
  
  // Streaming & Video
  "prime video",
  "primevideo",
  "video subscription",
  "streaming",
  "stream now",
  "watch now",
  "rent or buy",
  
  // Subscriptions & Memberships
  "subscription",
  "subscriptions",
  "membership",
  "memberships",
  "unlimited",
  "monthly plan",
  "annual plan",
  "free trial",
  
  // Digital Content
  "digital download",
  "digital code",
  "software license",
  "activation code",
]);

// ==================== HOME & GARDEN EXCLUSIONS ====================
// Seeds, vegetables, plants - NOT appropriate for AfriShop
// (AfriShop sells appliances, furniture, tools - not food/plants)
const HOME_GARDEN_BLOCKED_KEYWORDS = new Set([
  // Seeds
  "seeds",
  "seed packet",
  "seed packets",
  "heirloom seeds",
  "vegetable seeds",
  "flower seeds",
  "garden seeds",
  "herb seeds",
  "organic seeds",
  "non-gmo seeds",
  "seed lot",
  "seed mix",
  
  // Plants & Growing
  "seedling",
  "seedlings",
  "live plant",
  "live plants",
  "potted plant",
  "plant bulbs",
  "flower bulbs",
  "growing kit",
  "seed starter",
  "starter plants",
  
  // Vegetables & Produce (not selling food)
  "tomato seeds",
  "pepper seeds",
  "cucumber seeds",
  "lettuce seeds",
  "carrot seeds",
  "bean seeds",
  "squash seeds",
  "melon seeds",
  "pumpkin seeds",
  "corn seeds",
  "onion seeds",
  "spinach seeds",
  "kale seeds",
  "broccoli seeds",
  "cabbage seeds",
  "radish seeds",
  "beet seeds",
  "pea seeds",
  "tomato plant",
  "pepper plant",
  "cucumber plant",
  
  // Fertilizers & Chemicals (low margin, shipping issues)
  "fertilizer",
  "pesticide",
  "herbicide",
  "plant food",
  "potting soil",
  "garden soil",
  "potting mix",
  "mulch",
  "compost",
  "weed killer",
  "insecticide",
]);

// Allowlist for Home & Garden (prevent blocking legitimate products)
const HOME_GARDEN_ALLOWLIST = [
  "seed spreader",     // Lawn equipment
  "seed dispenser",    // Garden tool
  "vacuum seeder",     // Machinery
  "seed drill",        // Agricultural equipment
  "broadcast spreader", // Lawn equipment
  "lawn spreader",     // Garden tool
];

// ==================== ALLOWLIST PATTERNS ====================
// Products containing blocked keywords but are NOT blocked content
// These override keyword matches when found in title/URL
const ALLOWLIST_PATTERNS = [
  "macbook",
  "chromebook",
  "notebook",      // Laptop computers
  "facebook",      // Facebook products (Portal, etc.)
  "playbook",      // BlackBerry PlayBook, business software
  "scrapbook",     // Physical scrapbooks (craft supplies)
  "cookbook",      // Physical cookbooks are OK (not ebooks)
  "yearbook",      // Physical yearbooks
  "logbook",       // Stationery items
  "guestbook",     // Physical guestbooks
  "checkbook",     // Financial accessories
];

// ==================== BLOCKED CATEGORY PATHS ====================
// Applied when provider returns category path/hierarchy
const BLOCKED_CATEGORY_PATTERNS = [
  "books",
  "kindle store",
  "kindle ebooks",
  "audible books & originals",
  "audible audiobooks",
  "prime video",
  "amazon prime video",
  "digital music",
  "magazine subscriptions",
  "apps & games",
  "subscriptions",
  "video games subscriptions",
  "software",
  "digital software",
  "gift cards",
  "movies & tv",
];

// ==================== BLOCKED URL PATTERNS ====================
// Applied to product URLs
const BLOCKED_URL_PATTERNS = [
  "/gp/video",
  "/prime-video",
  "/primevideo",
  "/kindle",
  "/kindle-store",
  "/audible",
  "/magazines",
  "/books",
  "/dp/book",
  "/gp/product/B0",  // Many book ASINs start with B0
  "/digital-text",
  "/software",
  "/gift-card",
];

// ==================== BLOCKED ASIN PREFIXES ====================
// Book ASINs typically have patterns
// (Note: This is heuristic - not all B0 ASINs are books)
const BOOK_ASIN_INDICATORS = [
  // ASIN format checks - be careful not to block electronics
];

// ==================== ELECTRONICS REFILL QUERIES ====================
// Used when filtering results in empty response
export const ELECTRONICS_REFILL_QUERIES = [
  "iphone",
  "samsung phone",
  "unlocked phone",
  "laptop",
  "headphones",
  "earbuds",
  "monitor",
  "gaming monitor",
  "car accessories",
  "tesla accessories",
  "bluetooth speaker",
  "wireless charger",
  "power bank",
  "tablet",
  "smartwatch",
];

// ==================== MAIN FILTER FUNCTION ====================

export interface ContentFilterInput {
  title?: string | null;
  productUrl?: string | null;
  categoryPath?: string[] | null;
  category?: string | null;
  tags?: string[] | null;
  asin?: string | null;
  brand?: string | null;
  description?: string | null;
}

export interface DisallowedResult {
  isDisallowed: boolean;
  reason: string | null;
  matchedPattern: string | null;
}

/**
 * Check if an item is disallowed (books, subscriptions, streaming, etc.)
 * Returns { isDisallowed: boolean, reason: string, matchedPattern: string }
 */
export function isDisallowedItem(input: ContentFilterInput): DisallowedResult {
  const {
    title = "",
    productUrl = "",
    categoryPath = [],
    category = "",
    tags = [],
    description = "",
  } = input;

  // Normalize all strings to lowercase for comparison
  const titleLower = (title || "").toLowerCase();
  const urlLower = (productUrl || "").toLowerCase();
  const categoryLower = (category || "").toLowerCase();
  const descLower = (description || "").substring(0, 500).toLowerCase(); // Limit description check
  const tagsLower = (tags || []).map(t => (t || "").toLowerCase());
  const categoryPathLower = (categoryPath || []).map(c => (c || "").toLowerCase());

  // 1. Check keywords in title
  for (const keyword of BLOCKED_KEYWORDS) {
    let matches = false;
    
    // Word boundary matching for shorter keywords to avoid false positives
    if (keyword.length <= 5) {
      // Use word boundary regex for short keywords like "book"
      const regex = new RegExp(`\\b${escapeRegex(keyword)}\\b`, "i");
      matches = regex.test(titleLower);
    } else {
      // For longer keywords, simple includes is fine
      matches = titleLower.includes(keyword);
    }
    
    if (matches) {
      // Check if this match is part of an allowlisted product term
      const isAllowlisted = ALLOWLIST_PATTERNS.some(pattern => 
        titleLower.includes(pattern)
      );
      if (!isAllowlisted) {
        return { isDisallowed: true, reason: "keyword_title", matchedPattern: keyword };
      }
    }
  }

  // 2. Check keywords in URL
  for (const keyword of BLOCKED_KEYWORDS) {
    const keywordNormalized = keyword.replace(/\s+/g, "");
    if (urlLower.includes(keywordNormalized)) {
      // Check if this match is part of an allowlisted product term
      const isAllowlisted = ALLOWLIST_PATTERNS.some(pattern => 
        urlLower.includes(pattern)
      );
      if (!isAllowlisted) {
        return { isDisallowed: true, reason: "keyword_url", matchedPattern: keyword };
      }
    }
  }

  // 3. Check URL patterns
  for (const pattern of BLOCKED_URL_PATTERNS) {
    if (urlLower.includes(pattern.toLowerCase())) {
      return { isDisallowed: true, reason: "url_pattern", matchedPattern: pattern };
    }
  }

  // 4. Check category path
  for (const catPath of categoryPathLower) {
    for (const blocked of BLOCKED_CATEGORY_PATTERNS) {
      if (catPath.includes(blocked)) {
        return { isDisallowed: true, reason: "category_path", matchedPattern: blocked };
      }
    }
  }

  // 5. Check single category field
  for (const blocked of BLOCKED_CATEGORY_PATTERNS) {
    if (categoryLower.includes(blocked)) {
      return { isDisallowed: true, reason: "category", matchedPattern: blocked };
    }
  }

  // 6. Check tags
  for (const tag of tagsLower) {
    for (const keyword of BLOCKED_KEYWORDS) {
      if (tag.includes(keyword)) {
        return { isDisallowed: true, reason: "tag", matchedPattern: keyword };
      }
    }
  }

  // 7. Light check on description for streaming indicators only
  const streamingIndicators = ["prime video", "streaming", "subscription", "rent or buy", "watch now"];
  for (const indicator of streamingIndicators) {
    if (descLower.includes(indicator)) {
      return { isDisallowed: true, reason: "description_streaming", matchedPattern: indicator };
    }
  }

  // 8. Check HOME & GARDEN exclusions (seeds, vegetables, plants)
  // First check allowlist to avoid blocking legitimate garden equipment
  const isHomeGardenAllowlisted = HOME_GARDEN_ALLOWLIST.some(pattern => 
    titleLower.includes(pattern)
  );
  
  if (!isHomeGardenAllowlisted) {
    for (const keyword of HOME_GARDEN_BLOCKED_KEYWORDS) {
      let matches = false;
      
      // Word boundary matching for shorter keywords to avoid false positives
      if (keyword.length <= 5) {
        const regex = new RegExp(`\\b${escapeRegex(keyword)}\\b`, "i");
        matches = regex.test(titleLower);
      } else {
        matches = titleLower.includes(keyword);
      }
      
      if (matches) {
        return { isDisallowed: true, reason: "home_garden_exclusion", matchedPattern: keyword };
      }
    }
    
    // Also check for standalone "seed" as a word (singular) - common in product titles
    const seedRegex = /\bseed\b/i;
    if (seedRegex.test(titleLower)) {
      return { isDisallowed: true, reason: "home_garden_exclusion", matchedPattern: "seed" };
    }
    
    // Block items with "bulb" when in gardening context (not light bulbs)
    if (/\bbulbs?\b/i.test(titleLower) && !titleLower.includes("light") && !titleLower.includes("led") && !titleLower.includes("lamp")) {
      return { isDisallowed: true, reason: "home_garden_exclusion", matchedPattern: "bulb (gardening)" };
    }
  }

  return { isDisallowed: false, reason: null, matchedPattern: null };
}

/**
 * Filter an array of items, removing disallowed content
 * Returns { allowed: T[], removed: number, reasons: Record<string, number> }
 */
export function filterDisallowedItems<T extends ContentFilterInput>(
  items: T[],
  logPrefix: string = "[CATALOG_FILTER]"
): { allowed: T[]; removed: number; reasons: Record<string, number> } {
  const allowed: T[] = [];
  const reasons: Record<string, number> = {};
  let removed = 0;

  for (const item of items) {
    const result = isDisallowedItem(item);
    if (result.isDisallowed) {
      removed++;
      const key = result.reason || "unknown";
      reasons[key] = (reasons[key] || 0) + 1;
    } else {
      allowed.push(item);
    }
  }

  if (removed > 0) {
    console.log(`${logPrefix} removed=${removed} remaining=${allowed.length} reasons=${JSON.stringify(reasons)}`);
  }

  return { allowed, removed, reasons };
}

/**
 * Check if a search query itself targets blocked content
 * Returns true if the query is for books/subscriptions/streaming
 */
export function isBlockedSearchQuery(query: string): boolean {
  const qLower = (query || "").toLowerCase().trim();
  
  // Direct category blocks
  const blockedQueryPatterns = [
    "book",
    "books",
    "kindle",
    "audible",
    "audiobook",
    "ebook",
    "magazine",
    "prime video",
    "streaming",
    "subscription",
    "membership",
  ];

  for (const pattern of blockedQueryPatterns) {
    // Word boundary check for short patterns
    const regex = new RegExp(`\\b${escapeRegex(pattern)}\\b`, "i");
    if (regex.test(qLower)) {
      return true;
    }
  }

  return false;
}

/**
 * Get friendly message for blocked search
 */
export function getBlockedSearchMessage(lang: string = "en"): string {
  if (lang === "fr") {
    return "Cette catégorie n'est pas disponible sur AfriShop. Essayez électronique, téléphones ou accessoires.";
  }
  return "This category is not available on AfriShop. Try electronics, phones, or accessories.";
}

/**
 * Escape special regex characters
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Build SQL WHERE clause for excluding disallowed items
 * For use in database queries
 */
export function getDisallowedSqlConditions(): string[] {
  const conditions: string[] = [];
  
  // Title keyword blocks (using ILIKE for case-insensitive)
  const titleKeywords = [
    "kindle", "audible", "ebook", "e-book", "paperback", "hardcover",
    "audiobook", "magazine", "journal", "novel", "comics", "manga",
    "textbook", "prime video", "subscription", "membership", "streaming",
  ];
  
  for (const keyword of titleKeywords) {
    conditions.push(`title NOT ILIKE '%${keyword}%'`);
  }
  
  return conditions;
}

/**
 * Mark items as disallowed in the database
 * Returns count of items marked
 */
export async function markDisallowedItemsInDb(
  supabase: any,
  logPrefix: string = "[CATALOG_CLEANUP]"
): Promise<{ markedCount: number; deletedCount: number }> {
  // SQL patterns for title matching
  const titlePatterns = [
    "%kindle%",
    "%audible%",
    "%ebook%",
    "%e-book%",
    "% book%",
    "%book %",
    "%books%",
    "%paperback%",
    "%hardcover%",
    "%audiobook%",
    "%magazine%",
    "%journal%",
    "%novel%",
    "%comics%",
    "%manga%",
    "%textbook%",
    "%prime video%",
    "%subscription%",
    "%membership%",
    "%streaming%",
    "%unlimited%",
  ];

  // Build OR conditions for ILIKE
  const orConditions = titlePatterns.map(p => `title ILIKE '${p}'`).join(" OR ");
  
  // First, count items that would be marked
  const { count: markedCount } = await supabase
    .from("catalog_items")
    .select("id", { count: "exact", head: true })
    .or(orConditions);

  // Mark items as disallowed (if column exists)
  try {
    await supabase
      .from("catalog_items")
      .update({ is_disallowed: true })
      .or(orConditions);
  } catch (err) {
    console.warn(`${logPrefix} Could not mark items (column may not exist):`, err);
  }

  // Delete disallowed items from catalog_items to keep DB clean
  const { count: deletedCount } = await supabase
    .from("catalog_items")
    .delete({ count: "exact" })
    .or(orConditions);

  console.log(`${logPrefix} markedCount=${markedCount || 0} deletedCount=${deletedCount || 0}`);

  return {
    markedCount: markedCount || 0,
    deletedCount: deletedCount || 0,
  };
}
