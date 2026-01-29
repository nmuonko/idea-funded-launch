/**
 * catalog-category
 * Fetches items for a specific unified category or subcategory
 * Supports DB-first with eBay live pagination for limitless scrolling
 * 
 * Query params:
 * - category (required) - unified category slug or electronics subcategory
 *   Main categories: electronics, motors, home_garden, clothing_shoes_accessories, toys, sporting_goods, etc.
 *   Electronics subcategories: phones, computers, audio, monitors, tablets, chargers
 *   Aliases: vehicles->motors, clothing->clothing_shoes_accessories, etc.
 * - page default 1
 * - pageSize default 20
 * - mode: db | live (default: db)
 * - provider: ebay | rainforest (optional, default ebay)
 * - env (from header or param)
 * 
 * ALWAYS returns HTTP 200 with stable shape:
 * { status, env, category, page, pageSize, total, hasMore, items, error }
 * 
 * Motors: Only FIXED_PRICE (Buy It Now) items, $1500+ minimum, no parts
 * All categories: No books/subscriptions/streaming
 * Amazon/Rainforest: NEVER used for live pagination - eBay only
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { getEnvironmentFromRequest, EnvironmentName } from "../_shared/environmentResolver.ts";
import { isDisallowedItem } from "../_shared/contentBlocker.ts";
import { 
  TABS, 
  isValidCategory, 
  isElectronicsSubcategory, 
  mapCategoryAndSubcategory,
  resolveCategory,
  CATEGORY_ALIASES
} from "../_shared/categoryMapper.ts";
import { searchEbay, CatalogItem as EbayCatalogItem } from "../_shared/ebayAdapter.ts";
import { isAllowedMotorListing, MOTORS_SEED_QUERIES, MOTORS_MIN_PRICE_USD, buildEbayMotorsFilter } from "../_shared/motorsFilter.ts";

const ALLOWED_ENVS: EnvironmentName[] = ["production", "staging"];

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, apikey, content-type, x-client-info, x-device-id, x-afrishop-environment",
  "Access-Control-Max-Age": "86400",
  "Cache-Control": "public, max-age=120",
};

// ─── Seed Queries per Category ───────────────────────────────────────────────

const CATEGORY_SEED_QUERIES: Record<string, string[]> = {
  electronics: ["iphone", "samsung phone", "laptop", "headphones", "monitor", "tablet"],
  motors: MOTORS_SEED_QUERIES.slice(0, 8),
  home_garden: ["vacuum cleaner", "air fryer", "blender", "power tools", "patio furniture"],
  clothing_shoes_accessories: ["nike hoodie", "adidas shoes", "mens jacket", "womens dress", "sneakers"],
  toys: ["lego set", "kids toy", "rc car", "board game", "action figure"],
  sporting_goods: ["dumbbells", "soccer ball", "basketball", "yoga mat", "camping gear"],
  business_industrial: ["generator", "air compressor", "commercial equipment"],
  jewelry_watches: ["mens watch", "gold necklace", "diamond ring", "bracelet", "earrings"],
  refurbished: ["refurbished iphone", "renewed laptop", "certified refurbished"],
  // Electronics subcategories
  phones: ["iphone 15", "samsung galaxy", "android phone unlocked", "pixel phone"],
  computers: ["laptop", "macbook", "gaming laptop", "desktop computer", "chromebook"],
  audio: ["headphones", "airpods", "bluetooth speaker", "soundbar", "earbuds"],
  monitors: ["gaming monitor", "4k monitor", "ultrawide monitor", "27 inch monitor"],
  tablets: ["ipad", "samsung tablet", "android tablet", "ipad pro"],
  chargers: ["phone charger", "laptop charger", "usb-c cable", "wireless charger", "power bank"],
};

// Global deny keywords (applied to ALL categories)
const GLOBAL_DENY_KEYWORDS = [
  "kindle", "audible", "prime video", "subscription", "ebook", "e-book",
  "paperback", "hardcover", "book", "magazine", "manga", "streaming",
  "audiobook", "textbook", "novel", "comics"
];

interface CatalogItem {
  id: string;
  provider: string;
  providerProductId: string;
  title: string;
  priceUsd: number | null;
  imageUrl: string | null;
  images: string[];
  productUrl: string;
  inStock: boolean;
  rating: number | null;
  unifiedCategory: string;
  unifiedSubcategory: string | null;
}

interface DbItem {
  id: string;
  provider: string;
  provider_product_id: string;
  title: string;
  price_usd: number | null;
  image_url: string | null;
  images: unknown;
  product_url: string;
  in_stock: boolean | null;
  rating: number | null;
  unified_category: string | null;
  unified_subcategory: string | null;
  category_key: string | null;
}

function generateRequestId(): string {
  return crypto.randomUUID().slice(0, 8);
}

function normalizeItem(row: DbItem): CatalogItem {
  let images: string[] = [];
  if (Array.isArray(row.images)) {
    images = row.images.filter((img): img is string => typeof img === "string");
  } else if (typeof row.images === "string") {
    images = [row.images];
  }

  // Ensure ID is always provider:productId format
  let id = row.id;
  if (!id.includes(":")) {
    id = `${row.provider || "unknown"}:${row.provider_product_id || row.id}`;
  }

  return {
    id,
    provider: row.provider || "unknown",
    providerProductId: row.provider_product_id || row.id,
    title: row.title || "",
    priceUsd: row.price_usd,
    imageUrl: row.image_url || (images.length > 0 ? images[0] : null),
    images,
    productUrl: row.product_url || "",
    inStock: row.in_stock ?? true,
    rating: row.rating,
    unifiedCategory: row.unified_category || row.category_key || "electronics",
    unifiedSubcategory: row.unified_subcategory || null,
  };
}

function mapEbayItemToCatalogItem(item: EbayCatalogItem, category: string, subcategory: string | null): CatalogItem {
  // Ensure ID is always provider:productId format
  let id = item.id;
  if (!id.includes(":")) {
    id = `${item.provider}:${item.providerProductId}`;
  }

  return {
    id,
    provider: item.provider,
    providerProductId: item.providerProductId,
    title: item.title,
    priceUsd: item.priceUsd,
    imageUrl: item.imageUrl,
    images: item.images || [],
    productUrl: item.productUrl,
    inStock: item.inStock,
    rating: item.rating,
    unifiedCategory: category,
    unifiedSubcategory: subcategory,
  };
}

function isBlockedByGlobalDeny(title: string): boolean {
  const lowerTitle = title.toLowerCase();
  return GLOBAL_DENY_KEYWORDS.some(kw => lowerTitle.includes(kw.toLowerCase()));
}

// ─── eBay Live Fetch with Pagination ─────────────────────────────────────────

async function fetchEbayLiveItems(
  supabase: any,
  category: string,
  isMotors: boolean,
  page: number,
  pageSize: number,
  requestId: string
): Promise<{ items: CatalogItem[]; total: number; hasMore: boolean }> {
  const seedQueries = CATEGORY_SEED_QUERIES[category] || ["electronics"];
  const queryIndex = (page - 1) % seedQueries.length;
  const query = seedQueries[queryIndex];
  
  console.log(`[CAT_CATEGORY_LIVE_EBAY] requestId=${requestId} category=${category} page=${page} query="${query}"`);
  
  try {
    // For motors, use special filters
    const options: any = { marketplace: "EBAY_US" };
    if (isMotors) {
      options.filter = buildEbayMotorsFilter();
    }
    
    const result = await searchEbay(supabase, query, page, pageSize, options);
    
    if (result.items.length === 0) {
      console.log(`[CAT_CATEGORY_LIVE_EBAY] requestId=${requestId} query="${query}" returned 0`);
      return { items: [], total: 0, hasMore: false };
    }
    
    const allItems: CatalogItem[] = [];
    const seenIds = new Set<string>();
    
    for (const ebayItem of result.items) {
      if (seenIds.has(ebayItem.id)) continue;
      
      // Apply content filter
      if (isDisallowedItem({ title: ebayItem.title, productUrl: ebayItem.productUrl }).isDisallowed) {
        continue;
      }
      
      // Apply motors filter
      if (isMotors && !isAllowedMotorListing({ title: ebayItem.title, priceUsd: ebayItem.priceUsd }).isAllowed) {
        continue;
      }
      
      // Map category
      const { category: mappedCat, subcategory } = mapCategoryAndSubcategory({
        title: ebayItem.title,
        provider: "ebay",
      });
      
      if (mappedCat === "blocked") continue;
      
      // Force to requested category
      const item = mapEbayItemToCatalogItem(ebayItem, category, subcategory);
      
      seenIds.add(item.id);
      allItems.push(item);
    }
    
    console.log(`[CAT_CATEGORY_LIVE_EBAY] requestId=${requestId} query="${query}" fetched=${result.items.length} filtered=${allItems.length}`);
    
    // Upsert to DB for caching
    if (allItems.length > 0) {
      const toUpsert = allItems.map(item => ({
        id: item.id,
        provider: item.provider,
        provider_product_id: item.providerProductId,
        title: item.title,
        price_usd: item.priceUsd,
        image_url: item.imageUrl,
        images: item.images,
        product_url: item.productUrl,
        in_stock: item.inStock,
        rating: item.rating,
        unified_category: item.unifiedCategory,
        unified_subcategory: item.unifiedSubcategory,
        updated_at: new Date().toISOString(),
      }));
      
      const { error: upsertError } = await supabase
        .from("catalog_items")
        .upsert(toUpsert, { onConflict: "id" });
      
      if (upsertError) {
        console.error(`[CAT_CATEGORY_LIVE_EBAY] requestId=${requestId} upsert error:`, upsertError.message);
      }
    }
    
    return {
      items: allItems,
      total: result.total || allItems.length,
      hasMore: allItems.length >= pageSize,
    };
    
  } catch (err) {
    console.error(`[CAT_CATEGORY_LIVE_EBAY] requestId=${requestId} query="${query}" error:`, err);
    return { items: [], total: 0, hasMore: false };
  }
}

Deno.serve(async (req) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const requestId = generateRequestId();
  const startTime = Date.now();
  const url = new URL(req.url);

  let envName: EnvironmentName = "production";
  try {
    envName = getEnvironmentFromRequest(req);
  } catch {
    envName = "production";
  }

  // Parse query params
  let categoryRaw = url.searchParams.get("category") || url.searchParams.get("key") || url.searchParams.get("id") || "";
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));
  const pageSize = Math.min(50, Math.max(1, parseInt(url.searchParams.get("pageSize") || "20", 10)));
  const mode = url.searchParams.get("mode") || "db"; // db | live
  const provider = url.searchParams.get("provider") || "ebay"; // ebay | rainforest

  // Resolve category aliases (vehicles -> motors, etc.)
  const category = resolveCategory(categoryRaw);

  // Build response helper
  const buildResponse = (
    status: "success" | "error",
    items: CatalogItem[],
    total: number,
    hasMore: boolean,
    error: { message: string; code: string } | null
  ) => ({
    status,
    env: envName,
    category,
    categoryRequested: categoryRaw !== category ? categoryRaw : undefined,
    page,
    pageSize,
    total,
    hasMore,
    items,
    error,
    durationMs: Date.now() - startTime,
  });

  // Validate environment
  if (!ALLOWED_ENVS.includes(envName)) {
    console.error(`[CAT_CATEGORY_DB] requestId=${requestId} error=BAD_ENV env=${envName} category=${category}`);
    return new Response(
      JSON.stringify(buildResponse("error", [], 0, false, { message: `Invalid environment: ${envName}`, code: "BAD_ENV" })),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  console.log(`[CAT_CATEGORY_DB] requestId=${requestId} env=${envName} category=${category} (raw=${categoryRaw}) page=${page} pageSize=${pageSize} mode=${mode}`);

  if (!category) {
    console.error(`[CAT_CATEGORY_DB] requestId=${requestId} error=MISSING_CATEGORY`);
    return new Response(
      JSON.stringify(buildResponse("error", [], 0, false, { message: "Missing required 'category' parameter", code: "MISSING_CATEGORY" })),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // Validate category (after alias resolution)
  if (!isValidCategory(category)) {
    const validCategories = TABS.map(t => t.key).join(", ");
    const validSubcategories = "phones, computers, audio, monitors, tablets, chargers";
    const validAliases = Object.keys(CATEGORY_ALIASES).join(", ");
    console.error(`[CAT_CATEGORY_DB] requestId=${requestId} error=INVALID_CATEGORY category=${category}`);
    return new Response(
      JSON.stringify(buildResponse("error", [], 0, false, { 
        message: `Invalid category: ${categoryRaw}. Valid: ${validCategories}. Subcategories: ${validSubcategories}. Aliases: ${validAliases}`, 
        code: "INVALID_CATEGORY" 
      })),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseKey) {
      console.error(`[CAT_CATEGORY_DB] requestId=${requestId} error=MISSING_CONFIG`);
      return new Response(
        JSON.stringify(buildResponse("error", [], 0, false, { message: "Backend configuration error", code: "CONFIG_ERROR" })),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    // Determine query strategy
    const isSubcategory = isElectronicsSubcategory(category);
    const isMotors = category === "motors";

    // ─── MODE: LIVE - Use eBay directly with pagination ──────────────────────
    if (mode === "live" && provider === "ebay") {
      console.log(`[CAT_CATEGORY_LIVE_EBAY] requestId=${requestId} LIVE_MODE category=${category} page=${page}`);
      
      const liveResult = await fetchEbayLiveItems(
        supabase,
        category,
        isMotors,
        page,
        pageSize,
        requestId
      );
      
      console.log(`[CAT_CATEGORY_LIVE_EBAY] requestId=${requestId} category=${category} total=${liveResult.total} returned=${liveResult.items.length} hasMore=${liveResult.hasMore}`);
      
      return new Response(
        JSON.stringify(buildResponse("success", liveResult.items, liveResult.total, liveResult.hasMore, null)),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ─── MODE: DB - Query from database ──────────────────────────────────────
    const fetchLimit = pageSize * 4;

    // Build query
    let query = supabase.from("catalog_items").select("*", { count: "exact" });

    if (isSubcategory) {
      query = query
        .eq("unified_category", "electronics")
        .eq("unified_subcategory", category);
    } else {
      // Match both old and new category keys
      const categoryVariants = [category];
      // Add legacy variants
      if (category === "clothing_shoes_accessories") {
        categoryVariants.push("clothing");
      }
      query = query.in("unified_category", categoryVariants);
    }

    query = query
      .neq("unified_category", "blocked")
      .or("is_disallowed.is.null,is_disallowed.eq.false");

    if (isMotors) {
      query = query.gte("price_usd", MOTORS_MIN_PRICE_USD);
    }

    const { data: dbItems, count: dbCount, error: dbError } = await query
      .order("updated_at", { ascending: false })
      .range((page - 1) * pageSize, page * pageSize + fetchLimit - 1);

    if (dbError) {
      console.error(`[CAT_CATEGORY_DB] requestId=${requestId} error=DB_ERROR message=${dbError.message}`);
      return new Response(
        JSON.stringify(buildResponse("error", [], 0, false, { message: "Database error", code: "DB_ERROR" })),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Normalize and filter items
    let allItems: CatalogItem[] = [];
    let filteredCount = 0;

    for (const row of dbItems || []) {
      const item = normalizeItem(row as DbItem);

      if (isBlockedByGlobalDeny(item.title)) {
        filteredCount++;
        continue;
      }

      if (isMotors && !isAllowedMotorListing({ title: item.title, priceUsd: item.priceUsd }).isAllowed) {
        filteredCount++;
        continue;
      }

      if (isDisallowedItem({ title: item.title, productUrl: item.productUrl }).isDisallowed) {
        filteredCount++;
        continue;
      }

      allItems.push(item);
    }
    
    console.log(`[CAT_CATEGORY_DB] requestId=${requestId} dbRows=${dbItems?.length || 0} dbCount=${dbCount} filtered=${filteredCount} remaining=${allItems.length}`);

    // If DB is empty AND we're on page 1, try live fetch as fallback
    let liveTopUpCount = 0;
    if (allItems.length === 0 && page === 1) {
      console.log(`[CAT_CATEGORY_DB] requestId=${requestId} DB_EMPTY, fetching eBay live as fallback`);
      
      const liveResult = await fetchEbayLiveItems(
        supabase,
        category,
        isMotors,
        1,
        pageSize,
        requestId
      );
      
      allItems = liveResult.items;
      liveTopUpCount = liveResult.items.length;
    }

    // De-duplicate by id
    const uniqueMap = new Map<string, CatalogItem>();
    for (const item of allItems) {
      if (!uniqueMap.has(item.id)) {
        uniqueMap.set(item.id, item);
      }
    }

    // Sort: inStock first, then has price, then rating
    const sortedItems = Array.from(uniqueMap.values()).sort((a, b) => {
      if (a.inStock !== b.inStock) return a.inStock ? -1 : 1;
      const aHasPrice = a.priceUsd != null && a.priceUsd > 0;
      const bHasPrice = b.priceUsd != null && b.priceUsd > 0;
      if (aHasPrice !== bHasPrice) return aHasPrice ? -1 : 1;
      const aRating = a.rating ?? 0;
      const bRating = b.rating ?? 0;
      if (aRating !== bRating) return bRating - aRating;
      return 0;
    });

    // Paginate
    const total = dbCount || sortedItems.length;
    const pageItems = sortedItems.slice(0, pageSize);
    const hasMore = total > page * pageSize;

    const durationMs = Date.now() - startTime;
    console.log(`[CAT_CATEGORY_DB] requestId=${requestId} env=${envName} category=${category} isSubcategory=${isSubcategory} total=${total} returning=${pageItems.length} hasMore=${hasMore} liveTopUp=${liveTopUpCount} durationMs=${durationMs}`);

    return new Response(
      JSON.stringify({
        status: "success",
        env: envName,
        category,
        categoryRequested: categoryRaw !== category ? categoryRaw : undefined,
        isSubcategory,
        page,
        pageSize,
        total,
        hasMore,
        items: pageItems,
        dbCount: allItems.length - liveTopUpCount,
        liveTopUpCount,
        error: null,
        durationMs,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "Unknown error";
    const errorStack = err instanceof Error ? err.stack : undefined;
    const durationMs = Date.now() - startTime;
    
    console.error(`[CAT_CATEGORY_DB] requestId=${requestId} env=${envName} category=${category} error=INTERNAL_ERROR message=${errorMessage} durationMs=${durationMs}`);
    if (errorStack) {
      console.error(`[CAT_CATEGORY_DB] requestId=${requestId} stack=${errorStack}`);
    }

    return new Response(
      JSON.stringify(buildResponse("error", [], 0, false, { message: "Internal server error", code: "INTERNAL_ERROR" })),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
