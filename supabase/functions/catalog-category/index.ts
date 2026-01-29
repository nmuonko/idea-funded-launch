/**
 * catalog-category
 * Fetches items for a specific unified category or subcategory
 * Supports DB-first with eBay live pagination for limitless scrolling
 * 
 * Query params:
 * - category (required) - unified category slug
 *   Main categories: electronics, vehicles, home_garden, clothing_shoes_accessories, 
 *                   toys, sporting_goods, business_industrial, jewelry_watches, 
 *                   refurbished, parts_accessories
 *   Electronics subcategories: phones, computers, audio, monitors, tablets, chargers
 *   Vehicles subcategories: cars_trucks, motorcycles, powersports, boats, rvs_campers, trailers_other, classic_cars
 *   Parts subcategories: all_parts, car_truck_parts, wheels_tires, moto_scooter_parts, atv_utv_parts, tools_supplies
 * - sub (optional) - subcategory key
 * - page default 1
 * - pageSize default 20
 * - mode: db | live (default: db)
 * - provider: ebay | rainforest (optional, default ebay)
 * - env (from header or param)
 * 
 * ALWAYS returns HTTP 200 with stable shape:
 * { status, env, category, sub, page, pageSize, total, hasMore, items, error }
 * 
 * VEHICLES HARD FILTERS:
 * - ONLY Buy It Now / Fixed Price (NO auctions)
 * - Price >= $1,500 (enforced)
 * - Strong parts/accessories keyword exclusion
 * - eBay category path validation when available
 * 
 * PARTS: All automotive parts and accessories
 * ALL CATEGORIES: No books/subscriptions/streaming
 * AMAZON/RAINFOREST: NEVER used for live pagination - eBay only
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { getEnvironmentFromRequest, EnvironmentName } from "../_shared/environmentResolver.ts";
import { isDisallowedItem } from "../_shared/contentBlocker.ts";
import { 
  TABS, 
  isValidCategory, 
  isElectronicsSubcategory, 
  isVehiclesSubcategory,
  isPartsSubcategory,
  mapCategoryAndSubcategory,
  resolveCategory,
  CATEGORY_ALIASES
} from "../_shared/categoryMapper.ts";
import { searchEbay, CatalogItem as EbayCatalogItem } from "../_shared/ebayAdapter.ts";
import { 
  isAllowedMotorListing, 
  VEHICLES_MIN_PRICE_USD, 
  getMinPriceForVehicleSubkey,
  buildEbayVehiclesFilter,
  VEHICLES_SEED_QUERIES,
  PARTS_SEED_QUERIES,
  filterMotorListings,
} from "../_shared/motorsFilter.ts";
import { extractBrand, applyBrandDiversity, logBrandDistribution } from "../_shared/brandExtractor.ts";

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
  vehicles: VEHICLES_SEED_QUERIES.cars_trucks.slice(0, 6),
  parts_accessories: PARTS_SEED_QUERIES.all_parts.concat(PARTS_SEED_QUERIES.car_truck_parts.slice(0, 3)),
  home_garden: ["vacuum cleaner", "air fryer", "blender", "power tools", "patio furniture"],
  // DIVERSIFIED clothing queries - multiple brands + item types
  clothing_shoes_accessories: [
    "men hoodie", "women dress", "sneakers men", "sneakers women", "kids shoes",
    "jacket", "coat", "jeans", "t-shirt", "polo shirt", "sweater", "cardigan",
    "handbag", "backpack", "boots", "sunglasses", "belt", "watch",
    "nike", "adidas", "puma", "new balance", "reebok", "under armour",
    "levis jeans", "tommy hilfiger", "calvin klein", "zara", "tracksuit", "sportswear"
  ],
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
  // Vehicles subcategories - use actual vehicle queries
  cars_trucks: VEHICLES_SEED_QUERIES.cars_trucks,
  motorcycles: VEHICLES_SEED_QUERIES.motorcycles,
  powersports: VEHICLES_SEED_QUERIES.powersports,
  boats: VEHICLES_SEED_QUERIES.boats,
  rvs_campers: VEHICLES_SEED_QUERIES.rvs_campers,
  trailers_other: VEHICLES_SEED_QUERIES.trailers_other,
  classic_cars: VEHICLES_SEED_QUERIES.classic_cars,
  // Parts subcategories
  all_parts: PARTS_SEED_QUERIES.all_parts,
  car_truck_parts: PARTS_SEED_QUERIES.car_truck_parts,
  wheels_tires: PARTS_SEED_QUERIES.wheels_tires,
  moto_scooter_parts: PARTS_SEED_QUERIES.moto_scooter_parts,
  atv_utv_parts: PARTS_SEED_QUERIES.atv_utv_parts,
  tools_supplies: PARTS_SEED_QUERIES.tools_supplies,
};

// Global deny keywords (applied to ALL categories)
const GLOBAL_DENY_KEYWORDS = [
  "kindle", "audible", "prime video", "subscription", "ebook", "e-book",
  "paperback", "hardcover", "book", "magazine", "manga", "streaming",
  "audiobook", "textbook", "novel", "comics",
];

// ─── eBay Category IDs for Motors ─────────────────────────────────────────────
// These are the correct eBay Browse API category IDs for actual vehicles
const EBAY_CATEGORY_IDS: Record<string, string> = {
  // Vehicles
  cars_trucks: "6001",     // Cars & Trucks
  motorcycles: "6024",     // Motorcycles
  powersports: "66466",    // Powersports - ATVs, Snowmobiles, etc.
  boats: "26429",          // Boats
  rvs_campers: "50054",    // RVs & Campers
  trailers_other: "50056", // Trailers
  classic_cars: "6001",    // Same as cars_trucks, filter by keywords
};

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
  listingType: string | null;
  vehiclesSubkey: string | null;
  partsSubkey: string | null;
  brand: string | null;
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
  listing_type: string | null;
  vehicles_subkey: string | null;
  parts_subkey: string | null;
  brand: string | null;
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

  // Extract brand from title if not already stored
  const title = row.title || "";
  const brand = row.brand || extractBrand(title);

  return {
    id,
    provider: row.provider || "unknown",
    providerProductId: row.provider_product_id || row.id,
    title,
    priceUsd: row.price_usd,
    imageUrl: row.image_url || (images.length > 0 ? images[0] : null),
    images,
    productUrl: row.product_url || "",
    inStock: row.in_stock ?? true,
    rating: row.rating,
    unifiedCategory: row.unified_category || row.category_key || "electronics",
    unifiedSubcategory: row.unified_subcategory || null,
    listingType: row.listing_type || null,
    vehiclesSubkey: row.vehicles_subkey || null,
    partsSubkey: row.parts_subkey || null,
    brand,
  };
}

function mapEbayItemToCatalogItem(
  item: EbayCatalogItem, 
  category: string, 
  subcategory: string | null,
  listingType: string | null,
  vehiclesSubkey: string | null,
  partsSubkey: string | null
): CatalogItem {
  let id = item.id;
  if (!id.includes(":")) {
    id = `${item.provider}:${item.providerProductId}`;
  }

  // Extract brand from title
  const brand = extractBrand(item.title);

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
    listingType,
    vehiclesSubkey,
    partsSubkey,
    brand,
  };
}

function isBlockedByGlobalDeny(title: string): boolean {
  const lowerTitle = title.toLowerCase();
  return GLOBAL_DENY_KEYWORDS.some(kw => lowerTitle.includes(kw.toLowerCase()));
}

// ─── Query Builder for Vehicles ───────────────────────────────────────────────
function buildVehicleSearchQuery(category: string, sub: string | null): string {
  // Use specific vehicle makes/models to get actual vehicle listings
  if (sub === "cars_trucks" || category === "cars_trucks") {
    return "car for sale truck for sale suv sedan";
  }
  if (sub === "motorcycles" || category === "motorcycles") {
    return "motorcycle for sale harley honda";
  }
  if (sub === "powersports" || category === "powersports") {
    return "atv utv polaris rzr can-am";
  }
  if (sub === "boats" || category === "boats") {
    return "boat for sale fishing pontoon";
  }
  if (sub === "rvs_campers" || category === "rvs_campers") {
    return "rv motorhome camper travel trailer";
  }
  if (sub === "trailers_other" || category === "trailers_other") {
    return "utility trailer cargo enclosed";
  }
  if (sub === "classic_cars" || category === "classic_cars") {
    return "classic car vintage muscle 1960 1970";
  }
  // Default for vehicles category
  return "car for sale truck suv sedan";
}

// Build eBay filter with category ID + price + FIXED_PRICE for vehicles
function buildVehicleCategoryFilter(sub: string | null, minPrice: number): string {
  const categoryId = sub ? EBAY_CATEGORY_IDS[sub] : EBAY_CATEGORY_IDS.cars_trucks;
  
  // Base filter: FIXED_PRICE only + minimum price
  let filter = `buyingOptions:{FIXED_PRICE},price:[${minPrice}..]`;
  
  // Add category filter if we have a valid category ID
  if (categoryId) {
    filter += `,categoryIds:{${categoryId}}`;
  }
  
  return filter;
}

// ─── eBay Live Fetch with STRICT Vehicle Filtering ───────────────────────────

async function fetchEbayLiveItems(
  supabase: any,
  category: string,
  sub: string | null,
  isVehicles: boolean,
  isParts: boolean,
  page: number,
  pageSize: number,
  requestId: string
): Promise<{ items: CatalogItem[]; total: number; hasMore: boolean }> {
  // Get min price for vehicles (ENFORCED)
  const vehicleSubkey = isVehicles ? (sub || "cars_trucks") : null;
  const minPrice = isVehicles ? getMinPriceForVehicleSubkey(vehicleSubkey) : 0;
  
  // Build the search query based on category/sub
  let query: string;
  if (isVehicles) {
    query = buildVehicleSearchQuery(category, sub);
  } else if (isParts) {
    query = sub ? (PARTS_SEED_QUERIES[sub]?.[0] || "auto parts") : "auto parts";
  } else {
    const seedKey = sub || category;
    const seedQueries = CATEGORY_SEED_QUERIES[seedKey] || CATEGORY_SEED_QUERIES[category] || ["electronics"];
    query = seedQueries[0];
  }
  
  console.log(`[CAT_CATEGORY_LIVE_EBAY] requestId=${requestId} category=${category} sub=${sub} page=${page} minPrice=${minPrice} query="${query}"`);
  
  try {
    // For vehicles, use strict filter with eBay category IDs + price
    const options: any = { 
      marketplace: "EBAY_US",
      filter: isVehicles 
        ? buildVehicleCategoryFilter(sub, minPrice) 
        : "buyingOptions:{FIXED_PRICE},conditionIds:{1000|1500|2000|2500|3000}",
    };
    
    const result = await searchEbay(supabase, query, page, pageSize, options);
    
    if (result.items.length === 0) {
      console.log(`[CAT_CATEGORY_LIVE_EBAY] requestId=${requestId} query="${query}" returned 0`);
      return { items: [], total: 0, hasMore: false };
    }
    
    const allItems: CatalogItem[] = [];
    const seenIds = new Set<string>();
    let filteredByPrice = 0;
    let filteredByParts = 0;
    let filteredByContent = 0;
    
    for (const ebayItem of result.items) {
      if (seenIds.has(ebayItem.id)) continue;
      
      // Apply content filter
      if (isDisallowedItem({ title: ebayItem.title, productUrl: ebayItem.productUrl }).isDisallowed) {
        filteredByContent++;
        continue;
      }
      
      // For vehicles: Apply STRICT filtering using motorsFilter
      if (isVehicles) {
        const filterResult = isAllowedMotorListing({
          title: ebayItem.title,
          priceUsd: ebayItem.priceUsd,
          vehiclesSubkey: vehicleSubkey,
        });
        
        if (!filterResult.isAllowed) {
          if (filterResult.reason === "price_below_minimum") {
            filteredByPrice++;
          } else {
            filteredByParts++;
          }
          continue;
        }
      }
      
      // Map category
      const mappedResult = mapCategoryAndSubcategory({
        title: ebayItem.title,
        provider: "ebay",
        priceUsd: ebayItem.priceUsd,
      });
      
      if (mappedResult.category === "blocked") continue;
      
      // Force to requested category
      const item = mapEbayItemToCatalogItem(
        ebayItem, 
        category, 
        sub || mappedResult.subcategory,
        isVehicles ? "vehicle" : (isParts ? "part" : null),
        isVehicles ? (sub || mappedResult.vehiclesSubkey || "cars_trucks") : null,
        isParts ? (sub || mappedResult.partsSubkey || "all_parts") : null
      );
      
      seenIds.add(item.id);
      allItems.push(item);
    }
    
    console.log(`[CAT_CATEGORY_LIVE_EBAY] requestId=${requestId} query="${query}" fetched=${result.items.length} filtered=${allItems.length} byPrice=${filteredByPrice} byParts=${filteredByParts} byContent=${filteredByContent} total=${result.total}`);
    
    // Upsert to DB for caching (async, don't block response)
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
        listing_type: item.listingType,
        vehicles_subkey: item.vehiclesSubkey,
        parts_subkey: item.partsSubkey,
        brand: item.brand,
        updated_at: new Date().toISOString(),
      }));
      
      // Fire and forget - don't wait for upsert
      supabase.from("catalog_items").upsert(toUpsert, { onConflict: "id" });
    }
    
    return {
      items: allItems,
      total: result.total || (allItems.length + ((page - 1) * pageSize)),
      hasMore: result.hasMore || allItems.length >= pageSize,
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
  const sub = url.searchParams.get("sub") || null;
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));
  const pageSize = Math.min(50, Math.max(1, parseInt(url.searchParams.get("pageSize") || "20", 10)));
  const mode = url.searchParams.get("mode") || "db"; // db | live

  // Resolve category aliases (motors -> vehicles, etc.)
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
    sub,
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

  console.log(`[CAT_CATEGORY_DB] requestId=${requestId} env=${envName} category=${category} sub=${sub} (raw=${categoryRaw}) page=${page} pageSize=${pageSize} mode=${mode}`);

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
    const validAliases = Object.keys(CATEGORY_ALIASES).join(", ");
    console.error(`[CAT_CATEGORY_DB] requestId=${requestId} error=INVALID_CATEGORY category=${category}`);
    return new Response(
      JSON.stringify(buildResponse("error", [], 0, false, { 
        message: `Invalid category: ${categoryRaw}. Valid: ${validCategories}. Aliases: ${validAliases}`, 
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
    const isElecSubcat = isElectronicsSubcategory(category);
    const isVehSubcat = isVehiclesSubcategory(category);
    const isPartSubcat = isPartsSubcategory(category);
    const isVehicles = category === "vehicles" || isVehSubcat;
    const isParts = category === "parts_accessories" || isPartSubcat;

    // ─── LIVE eBay Mode ──────────────────────────────────────────────────────
    // Use LIVE for: explicit mode=live, OR (mode=auto AND vehicles/motors)
    const useLiveEbay = mode === "live" || (mode === "auto" && (isVehicles || isParts));

    if (useLiveEbay) {
      console.log(`[CAT_CATEGORY_LIVE_EBAY] requestId=${requestId} LIVE_MODE category=${category} sub=${sub} page=${page}`);
      
      const liveResult = await fetchEbayLiveItems(
        supabase,
        isVehSubcat ? "vehicles" : (isPartSubcat ? "parts_accessories" : category),
        isVehSubcat ? category : (isPartSubcat ? category : sub),
        isVehicles,
        isParts,
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

    if (isElecSubcat) {
      // Electronics subcategory
      query = query
        .eq("unified_category", "electronics")
        .eq("unified_subcategory", category);
    } else if (isVehSubcat) {
      // Vehicles subcategory
      query = query
        .eq("unified_category", "vehicles")
        .eq("listing_type", "vehicle")
        .eq("vehicles_subkey", category);
    } else if (isPartSubcat) {
      // Parts subcategory
      query = query
        .eq("unified_category", "parts_accessories")
        .eq("listing_type", "part")
        .eq("parts_subkey", category);
    } else if (category === "vehicles") {
      // Main vehicles category
      query = query
        .eq("unified_category", "vehicles")
        .eq("listing_type", "vehicle");
      if (sub) {
        query = query.eq("vehicles_subkey", sub);
      }
    } else if (category === "parts_accessories") {
      // Main parts category
      query = query
        .eq("unified_category", "parts_accessories")
        .eq("listing_type", "part");
      if (sub) {
        query = query.eq("parts_subkey", sub);
      }
    } else {
      // Other categories (electronics, home_garden, etc.)
      const categoryVariants = [category];
      if (category === "clothing_shoes_accessories") {
        categoryVariants.push("clothing");
      }
      if (category === "vehicles") {
        categoryVariants.push("motors");
      }
      query = query.in("unified_category", categoryVariants);
      
      if (sub) {
        query = query.eq("unified_subcategory", sub);
      }
    }

    query = query
      .neq("unified_category", "blocked")
      .or("is_disallowed.is.null,is_disallowed.eq.false");

    // Get minimum price for vehicles (ENFORCED)
    const vehicleSubkey = isVehicles ? (isVehSubcat ? category : sub) : null;
    const vehicleMinPrice = getMinPriceForVehicleSubkey(vehicleSubkey);

    // Apply minimum price for vehicles ($1500+)
    if (isVehicles) {
      query = query.gte("price_usd", vehicleMinPrice);
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

      // For vehicles, apply STRICT motorsFilter
      if (isVehicles) {
        const filterResult = isAllowedMotorListing({ 
          title: item.title, 
          priceUsd: item.priceUsd,
          vehiclesSubkey: vehicleSubkey 
        });
        if (!filterResult.isAllowed) {
          filteredCount++;
          continue;
        }
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
        isVehSubcat ? "vehicles" : (isPartSubcat ? "parts_accessories" : category),
        isVehSubcat ? category : (isPartSubcat ? category : sub),
        isVehicles,
        isParts,
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
    let uniqueItems = Array.from(uniqueMap.values());

    // ─── CLOTHING BRAND DIVERSITY ────────────────────────────────────────────
    const isClothing = category === "clothing_shoes_accessories" || category === "clothing" || category === "fashion";
    if (isClothing && page === 1 && uniqueItems.length > 0) {
      console.log(`[CAT_CATEGORY_DIVERSITY] requestId=${requestId} Applying brand diversity to ${uniqueItems.length} clothing items`);
      logBrandDistribution(uniqueItems, `[CAT_CATEGORY_DIVERSITY_BEFORE] requestId=${requestId}`);
      
      // Apply diversity: max 2 items per brand in the first 20 results
      uniqueItems = applyBrandDiversity(uniqueItems, 2, pageSize);
      
      logBrandDistribution(uniqueItems, `[CAT_CATEGORY_DIVERSITY_AFTER] requestId=${requestId}`);
    }

    // Paginate
    const pageItems = uniqueItems.slice(0, pageSize);
    const total = dbCount || uniqueItems.length;
    const hasMore = uniqueItems.length > pageSize || (dbCount || 0) > page * pageSize;

    const durationMs = Date.now() - startTime;
    console.log(`[CAT_CATEGORY_DB] requestId=${requestId} category=${category} sub=${sub} total=${total} returned=${pageItems.length} hasMore=${hasMore} liveTopUp=${liveTopUpCount} durationMs=${durationMs}`);

    return new Response(
      JSON.stringify(buildResponse("success", pageItems, total, hasMore, null)),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "Unknown error";
    const durationMs = Date.now() - startTime;
    
    console.error(`[CAT_CATEGORY_DB] requestId=${requestId} error=INTERNAL_ERROR message=${errorMessage} durationMs=${durationMs}`);

    return new Response(
      JSON.stringify(buildResponse("error", [], 0, false, { message: "Internal server error", code: "INTERNAL_ERROR" })),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
