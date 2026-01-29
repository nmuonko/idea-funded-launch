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
// Use EXPLICIT vehicle-focused queries that exclude parts
function buildVehicleSearchQuery(category: string, sub: string | null): string {
  // Use specific vehicle makes/models to get actual vehicle listings
  if (sub === "cars_trucks" || category === "cars_trucks") {
    return "used car for sale sedan suv truck coupe wagon";
  }
  if (sub === "motorcycles" || category === "motorcycles") {
    return "motorcycle for sale harley davidson honda yamaha kawasaki";
  }
  if (sub === "powersports" || category === "powersports") {
    return "atv quad for sale side by side utv 4 wheeler";
  }
  if (sub === "boats" || category === "boats") {
    return "boat for sale bass boat pontoon fishing boat sailboat";
  }
  if (sub === "rvs_campers" || category === "rvs_campers") {
    return "rv motorhome camper travel trailer fifth wheel";
  }
  if (sub === "trailers_other" || category === "trailers_other") {
    return "utility trailer cargo trailer enclosed trailer flatbed";
  }
  if (sub === "classic_cars" || category === "classic_cars") {
    return "classic car for sale vintage muscle car antique";
  }
  // Default for vehicles category
  return "car for sale truck suv sedan coupe";
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
// VEHICLES: Always use live eBay, never return empty due to DB-only mode

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
  
  // Build search query - vehicles get multiple fallback queries
  const queriesToTry: string[] = [];
  
  if (isVehicles) {
    // Primary query
    queriesToTry.push(buildVehicleSearchQuery(category, sub));
    
    // Fallback queries for vehicles - more explicit vehicle listings
    if (sub === "cars_trucks" || !sub) {
      queriesToTry.push("toyota camry for sale", "honda accord for sale", "ford f150 for sale", "chevrolet silverado for sale");
    } else if (sub === "motorcycles") {
      queriesToTry.push("harley davidson for sale", "honda goldwing for sale", "yamaha r1 for sale", "cruiser motorcycle for sale");
    } else if (sub === "powersports") {
      queriesToTry.push("atv quad 4 wheeler for sale", "polaris sportsman for sale", "honda rancher atv", "side by side utv for sale");
    } else if (sub === "boats") {
      queriesToTry.push("bass tracker boat for sale", "pontoon boat for sale", "fishing boat for sale", "ski boat for sale");
    } else if (sub === "rvs_campers") {
      queriesToTry.push("travel trailer for sale", "fifth wheel for sale", "class a motorhome for sale", "pop up camper for sale");
    } else if (sub === "trailers_other") {
      queriesToTry.push("utility trailer for sale", "cargo trailer for sale", "enclosed trailer for sale", "car hauler trailer for sale");
    } else if (sub === "classic_cars") {
      queriesToTry.push("classic mustang for sale", "classic corvette for sale", "classic camaro for sale", "classic truck for sale");
    }
  } else if (isParts) {
    queriesToTry.push(sub ? (PARTS_SEED_QUERIES[sub]?.[0] || "auto parts") : "auto parts");
  } else {
    const seedKey = sub || category;
    const seedQueries = CATEGORY_SEED_QUERIES[seedKey] || CATEGORY_SEED_QUERIES[category] || ["electronics"];
    queriesToTry.push(...seedQueries.slice(0, 2));
  }
  
  console.log(`[CAT_CATEGORY_LIVE_EBAY] requestId=${requestId} category=${category} sub=${sub} page=${page} minPrice=${minPrice} queries=${queriesToTry.length}`);
  
  // Try queries until we get results
  for (const query of queriesToTry) {
    try {
      console.log(`[VEHICLE_LIVE] requestId=${requestId} trying query="${query}" category=${category} sub=${sub}`);
      
      // For vehicles, use strict filter with eBay category IDs + price
      const options: any = { 
        marketplace: "EBAY_US",
        filter: isVehicles 
          ? buildVehicleCategoryFilter(sub, minPrice) 
          : "buyingOptions:{FIXED_PRICE},conditionIds:{1000|1500|2000|2500|3000}",
      };
      
      const result = await searchEbay(supabase, query, page, pageSize, options);
      
      if (result.items.length === 0) {
        console.log(`[VEHICLE_LIVE] requestId=${requestId} query="${query}" returned 0, trying next`);
        continue;
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
              console.log(`[VEHICLE_BLOCK] requestId=${requestId} blocked="${ebayItem.title?.slice(0,50)}" reason=${filterResult.reason}`);
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
      
      console.log(`[VEHICLE_LIVE] requestId=${requestId} query="${query}" fetched=${result.items.length} passed=${allItems.length} byPrice=${filteredByPrice} byParts=${filteredByParts} byContent=${filteredByContent} total=${result.total}`);
      
      // If we got items, upsert and return
      if (allItems.length > 0) {
        // Upsert to DB for caching (async, don't block response)
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
        
        return {
          items: allItems,
          total: result.total || (allItems.length + ((page - 1) * pageSize)),
          hasMore: result.hasMore || allItems.length >= pageSize,
        };
      }
      
    } catch (err) {
      console.error(`[VEHICLE_LIVE] requestId=${requestId} query="${query}" error:`, err);
    }
  }
  
  // All queries exhausted
  console.warn(`[VEHICLE_LIVE] requestId=${requestId} ALL_QUERIES_EXHAUSTED category=${category} sub=${sub}`);
  return { items: [], total: 0, hasMore: false };
}

// ─── UNIFIED CATEGORY KEY MAPPING ─────────────────────────────────────────
// Maps legacy params to unified keys: vehicles_cars_trucks, vehicles_motorcycles, etc.
const VEHICLE_SUB_TO_UNIFIED: Record<string, string> = {
  cars_trucks: "vehicles_cars_trucks",
  motorcycles: "vehicles_motorcycles",
  powersports: "vehicles_powersports",
  boats: "vehicles_boats",
  rvs_campers: "vehicles_rvs_campers",
  trailers_other: "vehicles_trailers_other",
  classic_cars: "vehicles_classic_cars",
  parts_accessories: "vehicles_parts_accessories",
};

// Reverse mapping: unified key -> subcategory
const UNIFIED_TO_VEHICLE_SUB: Record<string, string> = {
  vehicles_cars_trucks: "cars_trucks",
  vehicles_motorcycles: "motorcycles",
  vehicles_powersports: "powersports",
  vehicles_boats: "boats",
  vehicles_rvs_campers: "rvs_campers",
  vehicles_trailers_other: "trailers_other",
  vehicles_classic_cars: "classic_cars",
  vehicles_parts_accessories: "parts_accessories",
};

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
  const categoryRaw = url.searchParams.get("category") || url.searchParams.get("key") || url.searchParams.get("id") || "";
  const subRaw = url.searchParams.get("sub") || null;
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));
  const pageSize = Math.min(50, Math.max(1, parseInt(url.searchParams.get("pageSize") || "20", 10)));
  const mode = url.searchParams.get("mode") || "db"; // db | live

  // ─── NORMALIZE CATEGORY ─────────────────────────────────────────────────────
  // Resolve finalCategory: handles unified keys AND legacy params
  let finalCategory: string;
  let effectiveSub: string | null = null;

  // Case 1: Already a unified key like "vehicles_cars_trucks"
  if (categoryRaw.startsWith("vehicles_") && UNIFIED_TO_VEHICLE_SUB[categoryRaw]) {
    finalCategory = "vehicles";
    effectiveSub = UNIFIED_TO_VEHICLE_SUB[categoryRaw];
  }
  // Case 2: Legacy params: category=vehicles & sub=cars_trucks
  else if ((categoryRaw === "vehicles" || categoryRaw === "motors") && subRaw && VEHICLE_SUB_TO_UNIFIED[subRaw]) {
    finalCategory = "vehicles";
    effectiveSub = subRaw;
  }
  // Case 3: Direct subcategory access (e.g., category=cars_trucks)
  else if (isVehiclesSubcategory(categoryRaw)) {
    finalCategory = "vehicles";
    effectiveSub = categoryRaw;
  }
  // Case 4: Parts unified key like "vehicles_parts_accessories"
  else if (categoryRaw === "vehicles_parts_accessories") {
    finalCategory = "parts_accessories";
    effectiveSub = null;
  }
  // Case 5: Normal category resolution with alias support
  else {
    finalCategory = resolveCategory(categoryRaw);
    effectiveSub = subRaw;
  }

  // Build response helper - ALWAYS returns status: "success", uses warning for errors
  const buildResponse = (
    items: CatalogItem[],
    total: number,
    hasMore: boolean,
    warning: { message: string; code: string; debugId?: string } | null
  ) => ({
    status: "success" as const,
    env: envName,
    category: finalCategory,
    categoryRequested: categoryRaw !== finalCategory ? categoryRaw : undefined,
    sub: effectiveSub,
    page,
    pageSize,
    total,
    hasMore,
    items,
    warning,
    durationMs: Date.now() - startTime,
  });

  // Log the category resolution
  console.log(`[CAT_CATEGORY] requestId=${requestId} finalCategory=${finalCategory} effectiveSub=${effectiveSub} categoryRaw=${categoryRaw} subRaw=${subRaw} page=${page} pageSize=${pageSize} mode=${mode} env=${envName}`);

  // Validate environment - return success with warning, not error
  if (!ALLOWED_ENVS.includes(envName)) {
    console.error(`[CAT_CATEGORY] requestId=${requestId} warning=BAD_ENV env=${envName}`);
    return new Response(
      JSON.stringify(buildResponse([], 0, false, { message: `Invalid environment: ${envName}`, code: "BAD_ENV", debugId: requestId })),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  if (!finalCategory) {
    console.error(`[CAT_CATEGORY] requestId=${requestId} warning=MISSING_CATEGORY`);
    return new Response(
      JSON.stringify(buildResponse([], 0, false, { message: "Missing required 'category' parameter", code: "MISSING_CATEGORY", debugId: requestId })),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // Validate category (after alias resolution)
  if (!isValidCategory(finalCategory)) {
    const validCategories = TABS.map(t => t.key).join(", ");
    console.error(`[CAT_CATEGORY] requestId=${requestId} warning=INVALID_CATEGORY category=${finalCategory}`);
    return new Response(
      JSON.stringify(buildResponse([], 0, false, { 
        message: `Invalid category: ${categoryRaw}. Valid: ${validCategories}`, 
        code: "INVALID_CATEGORY",
        debugId: requestId
      })),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseKey) {
      console.error(`[CAT_CATEGORY] requestId=${requestId} warning=MISSING_CONFIG`);
      return new Response(
        JSON.stringify(buildResponse([], 0, false, { message: "Backend configuration error", code: "CONFIG_ERROR", debugId: requestId })),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    // Determine query strategy
    const isElecSubcat = isElectronicsSubcategory(finalCategory);
    const isVehSubcat = isVehiclesSubcategory(effectiveSub || "");
    const isPartSubcat = isPartsSubcategory(effectiveSub || "");
    const isVehicles = finalCategory === "vehicles" || isVehSubcat;
    const isParts = finalCategory === "parts_accessories" || isPartSubcat;

    // ─── PROVIDER/MODE DECISION ──────────────────────────────────────────────
    // eBay: ALWAYS allowed to be live (no credit worries)
    // Amazon/Rainforest: DB-first ONLY, cached, restricted
    // Vehicles: FORCE LIVE eBay (ALWAYS) - never use DB-only for vehicles
    
    const isEbayCategory = isVehicles || isParts || 
      ["electronics", "home_garden", "clothing_shoes_accessories", "toys", "sporting_goods", 
       "business_industrial", "jewelry_watches", "refurbished"].includes(finalCategory);
    
    // VEHICLES: ALWAYS use LIVE eBay - this is the key fix
    // eBay is allowed live, so vehicles should NEVER return empty due to DB-only mode
    const forceLiveForVehicles = isVehicles; // Cars, motorcycles, boats, etc. ALWAYS live
    const useLiveEbay = forceLiveForVehicles || mode === "live" || (mode === "auto" && isEbayCategory);
    const effectiveMode = useLiveEbay ? "live" : "db";
    const provider = isEbayCategory ? "ebay" : "rainforest";

    console.log(`[CAT_CATEGORY] requestId=${requestId} provider=${provider} effectiveMode=${effectiveMode} isVehicles=${isVehicles} isParts=${isParts} forceLiveForVehicles=${forceLiveForVehicles}`);

    // ─── VEHICLES: ALWAYS LIVE (never empty due to DB-only) ──────────────────
    if (isVehicles) {
      console.log(`[VEHICLE_LIVE] requestId=${requestId} category=${finalCategory} sub=${effectiveSub} page=${page} offset=${(page-1)*pageSize} FORCING_LIVE_EBAY`);
      
      const liveResult = await fetchEbayLiveItems(
        supabase,
        finalCategory,
        effectiveSub,
        true, // isVehicles
        false, // isParts
        page,
        pageSize,
        requestId
      );
      
      console.log(`[VEHICLE_LIVE] requestId=${requestId} category=${finalCategory} sub=${effectiveSub} total=${liveResult.total} returned=${liveResult.items.length} hasMore=${liveResult.hasMore}`);
      
      // If live returned 0, log warning but still return success
      if (liveResult.items.length === 0) {
        console.warn(`[VEHICLE_LIVE] requestId=${requestId} WARNING: Live eBay returned 0 vehicles for ${finalCategory}/${effectiveSub}`);
        return new Response(
          JSON.stringify(buildResponse([], 0, false, { 
            message: "No vehicles currently available. Please try again shortly.", 
            code: "EMPTY_VEHICLES", 
            debugId: requestId 
          })),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      
      return new Response(
        JSON.stringify(buildResponse(liveResult.items, liveResult.total, liveResult.hasMore, null)),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ─── OTHER EBAY CATEGORIES: Live if requested ────────────────────────────
    if (useLiveEbay && !isVehicles) {
      console.log(`[CAT_CATEGORY_LIVE_EBAY] requestId=${requestId} LIVE_MODE finalCategory=${finalCategory} effectiveSub=${effectiveSub} page=${page} offset=${(page-1)*pageSize}`);
      
      const liveResult = await fetchEbayLiveItems(
        supabase,
        finalCategory,
        effectiveSub,
        false, // Not vehicles
        isParts,
        page,
        pageSize,
        requestId
      );
      
      console.log(`[CAT_CATEGORY_LIVE_EBAY] requestId=${requestId} category=${finalCategory} sub=${effectiveSub} total=${liveResult.total} returned=${liveResult.items.length} hasMore=${liveResult.hasMore}`);
      
      return new Response(
        JSON.stringify(buildResponse(liveResult.items, liveResult.total, liveResult.hasMore, null)),
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
        .eq("unified_subcategory", finalCategory);
    } else if (isVehSubcat) {
      // Vehicles subcategory
      query = query
        .eq("unified_category", "vehicles")
        .eq("listing_type", "vehicle")
        .eq("vehicles_subkey", effectiveSub);
    } else if (isPartSubcat) {
      // Parts subcategory
      query = query
        .eq("unified_category", "parts_accessories")
        .eq("listing_type", "part")
        .eq("parts_subkey", effectiveSub);
    } else if (finalCategory === "vehicles") {
      // Main vehicles category
      query = query
        .eq("unified_category", "vehicles")
        .eq("listing_type", "vehicle");
      if (effectiveSub) {
        query = query.eq("vehicles_subkey", effectiveSub);
      }
    } else if (finalCategory === "parts_accessories") {
      // Main parts category
      query = query
        .eq("unified_category", "parts_accessories")
        .eq("listing_type", "part");
      if (effectiveSub) {
        query = query.eq("parts_subkey", effectiveSub);
      }
    } else {
      // Other categories (electronics, home_garden, etc.)
      const categoryVariants = [finalCategory];
      if (finalCategory === "clothing_shoes_accessories") {
        categoryVariants.push("clothing");
      }
      if (finalCategory === "vehicles") {
        categoryVariants.push("motors");
      }
      query = query.in("unified_category", categoryVariants);
      
      if (effectiveSub) {
        query = query.eq("unified_subcategory", effectiveSub);
      }
    }

    query = query
      .neq("unified_category", "blocked")
      .or("is_disallowed.is.null,is_disallowed.eq.false");

    // Get minimum price for vehicles (ENFORCED)
    const vehicleSubkey = isVehicles ? (isVehSubcat ? effectiveSub : effectiveSub) : null;
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
        JSON.stringify(buildResponse([], 0, false, { message: "Database error", code: "DB_ERROR", debugId: requestId })),
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
        finalCategory,
        effectiveSub,
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
    const isClothing = finalCategory === "clothing_shoes_accessories" || finalCategory === "clothing" || finalCategory === "fashion";
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
    console.log(`[CAT_CATEGORY_DB] requestId=${requestId} category=${finalCategory} sub=${effectiveSub} total=${total} returned=${pageItems.length} hasMore=${hasMore} liveTopUp=${liveTopUpCount} durationMs=${durationMs}`);

    return new Response(
      JSON.stringify(buildResponse(pageItems, total, hasMore, null)),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "Unknown error";
    const durationMs = Date.now() - startTime;
    
    console.error(`[CAT_CATEGORY] requestId=${requestId} error=INTERNAL_ERROR message=${errorMessage} durationMs=${durationMs}`);

    return new Response(
      JSON.stringify(buildResponse([], 0, false, { message: "Internal server error", code: "INTERNAL_ERROR", debugId: requestId })),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
