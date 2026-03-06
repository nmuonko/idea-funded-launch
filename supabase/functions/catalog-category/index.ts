/**
 * catalog-category
 * Fetches items for a specific category/subtab with cursor-based pagination
 * Uses canonical category registry for alias resolution
 * 
 * PROVIDER MIXING (Amazon + eBay):
 * - Mixed mode: Amazon-first, then blend, then eBay-only
 * - Budget control for Amazon API calls
 * - Cursor-based infinite pagination
 * 
 * VEHICLES:
 * - ALWAYS use live eBay Browse API
 * - Each subcategory uses correct eBay category_id
 * - Strict filters: FIXED_PRICE only, min price, exclude parts keywords
 * 
 * ALWAYS returns HTTP 200 with stable JSON:
 * { status, items, nextCursor, hasMore, categoryResolved, providerStats }
 */

import { createClient } from "@supabase/supabase-js";
import { getEnvironmentFromRequest, EnvironmentName } from "../_shared/environmentResolver.ts";
import { isDisallowedItem, filterDisallowedItems } from "../_shared/contentBlocker.ts";
import { searchEbay, searchEbayWithFallback, upsertItemsToDb, NormalizedItem } from "../_shared/ebayBrowseSearch.ts";
import { isAllowedMotorListing } from "../_shared/motorsFilter.ts";
import { extractBrand, applyBrandDiversity, applyItemDiversity } from "../_shared/brandExtractor.ts";
import { 
  resolveCategory, 
  resolveCategoryOrError,
  getCategoryMeta,
  getEbayCategoryId,
  getMinPrice,
  ALL_CANONICAL_KEYS,
  CategoryResolution,
  CategoryResolutionError,
} from "../_shared/categoryRegistry.ts";
import { normalizeAndValidateImageUrl } from "../_shared/imageValidation.ts";
import { getCatalogSettings, getEffectiveMode, CatalogSettings } from "../_shared/catalogSettings.ts";
import { checkBudget, incrementBudget, resolveAmazonStatus, AmazonStatusInfo } from "../_shared/providerBudget.ts";
import { 
  mixProviderItems, 
  encodeMixerCursor, 
  decodeMixerCursor, 
  getInitialCursor,
  logMixerDebug,
  MixerCursor,
  ProviderItem,
  buildProviderStats,
  ProviderStats,
} from "../_shared/providerMixer.ts";
import { enrichItemsWithMediaCounts } from "../_shared/mediaCache.ts";
import {
  SortOption,
  CatalogFilters,
  validateSort,
  parseFilters,
  getDbSort,
  postFilterItems,
  postSortItems,
  buildAppliedSortFilter,
} from "../_shared/sortFilterNormalizer.ts";

const ALLOWED_ENVS: EnvironmentName[] = ["production", "staging"];
const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 200;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, apikey, content-type, x-client-info, x-device-id, x-afrishop-environment",
  "Access-Control-Max-Age": "86400",
  "Cache-Control": "public, max-age=120",
};

// ─── Vehicle Seed Queries ─────────────────────────────────────────────────────

const VEHICLE_FALLBACK_QUERIES: Record<string, string[]> = {
  vehicles: ["car for sale truck suv sedan coupe", "used car for sale clean title", "pickup truck 4x4"],
  vehicles_all: ["car for sale truck suv sedan coupe", "used car for sale clean title", "toyota honda ford chevrolet"],
  vehicles_cars_trucks: ["sedan coupe for sale clean title", "used car low miles", "pickup truck 4x4 crew cab"],
  vehicles_motorcycles: ["motorcycle for sale harley honda", "cruiser touring sportbike", "used motorcycle clean title"],
  vehicles_powersports: ["atv quad 4 wheeler polaris", "side by side utv rzr", "can-am yamaha"],
  vehicles_boats: ["boat for sale bass tracker", "pontoon boat fishing boat", "center console boat"],
  vehicles_rvs_campers: ["rv motorhome for sale", "travel trailer fifth wheel", "class a class c camper"],
  vehicles_trailers_other: ["utility trailer enclosed cargo", "flatbed trailer dump trailer", "car hauler trailer"],
  vehicles_classic_cars: ["classic car for sale restored", "vintage mustang corvette camaro", "muscle car clean title"],
};

const CATEGORY_FALLBACK_QUERIES: Record<string, string[]> = {
  electronics: ["iphone", "samsung phone", "laptop", "headphones"],
  electronics_phones: ["iphone 15", "samsung galaxy", "google pixel"],
  electronics_computers: ["laptop", "macbook", "gaming laptop", "desktop computer"],
  electronics_gaming: ["ps5 console", "xbox series x", "nintendo switch"],
  electronics_cameras: ["dslr camera", "gopro", "mirrorless camera"],
  electronics_audio: ["airpods", "bose headphones", "jbl speaker"],
  home_garden: ["living room sofa set", "dining table set chairs", "kitchen cabinet storage", "TV stand entertainment center"],
  clothing_shoes_accessories: ["sneakers", "hoodie", "jacket", "handbag", "shoes"],
  clothing_men: ["men hoodie", "men jacket", "men jeans", "men shirt"],
  clothing_women: ["women dress", "women jacket", "women blouse"],
  clothing_girls: ["girls dress", "girls clothing", "girls outfit"],
  clothing_boys: ["boys clothing", "boys outfit", "boys shirt"],
  clothing_baby: ["baby clothes", "baby outfit", "infant clothing"],
  clothing_shoes: ["nike shoes", "adidas sneakers", "boots"],
  clothing_bags: ["handbag", "backpack", "crossbody bag"],
  clothing_luggage: ["luggage", "suitcase", "travel bag"],
  toys: ["lego set", "kids toy", "rc car", "board game"],
  sporting_goods: ["dumbbells", "soccer ball", "basketball", "yoga mat"],
  business_industrial: ["generator", "air compressor", "commercial equipment"],
  jewelry_watches: ["mens watch", "gold necklace", "diamond ring", "bracelet"],
  refurbished: ["refurbished iphone", "renewed laptop", "certified refurbished"],
  parts_accessories: ["auto parts", "car parts", "brake pads", "oil filter"],
  vehicles_parts_accessories: ["car parts", "auto parts", "brake pads", "oil filter"],
  // New homepage categories
  audio_music: ["bose speaker", "jbl speaker", "headphones", "guitar", "marshall amplifier"],
  beauty_health: ["perfume", "skincare", "makeup", "hair dryer", "electric shaver"],
  collectibles: ["trading cards", "collectible figurine", "vintage", "funko pop"],
  shoes_sneakers: ["nike shoes", "jordan sneakers", "adidas", "new balance"],
  cameras_photo: ["canon camera", "gopro", "nikon dslr", "sony mirrorless"],
};

// Default Amazon queries per category (same as /catalog-home see_all.q)
// Used when browsing a category with no explicit search query
const AMAZON_DEFAULT_QUERIES: Record<string, string> = {
  // Top-level tabs
  electronics: "iphone",
  electronics_phones: "iphone",
  electronics_computers: "laptop",
  electronics_gaming: "ps5",
  electronics_cameras: "camera",
  electronics_audio: "headphones",
  vehicles: "cars",
  vehicles_all: "cars",
  vehicles_cars_trucks: "cars",
  vehicles_motorcycles: "motorcycle",
  vehicles_powersports: "atv",
  vehicles_boats: "boat",
  vehicles_rvs_campers: "rv",
  vehicles_trailers_other: "trailer",
  vehicles_classic_cars: "classic car",
  home_garden: "living room sofa set dining table set kitchen cabinet",
  clothing_shoes_accessories: "shoes",
  clothing_men: "men clothing",
  clothing_women: "women clothing",
  clothing_girls: "girls clothing",
  clothing_boys: "boys clothing",
  clothing_baby: "baby clothes",
  clothing_shoes: "sneakers",
  clothing_bags: "handbag",
  clothing_luggage: "luggage suitcase",
  toys: "lego",
  sporting_goods: "fitness",
  business_industrial: "generator",
  jewelry_watches: "watch",
  refurbished: "refurbished",
  parts_accessories: "parts",
  vehicles_parts_accessories: "car parts",
};

// ─── RESPONSE TYPES ───────────────────────────────────────────────────────────

interface CatalogProduct extends ProviderItem {
  id: string;
  provider: string;
  providerProductId: string;
  title: string;
  priceUsd: number | null;
  mainImageUrl: string | null;   // Single best image for list performance
  imageUrl: string | null;       // Backward compat
  images: string[];              // Full image gallery
  imageUrls: string[];           // Full image gallery (alias)
  imageCount: number;            // Total images available from listing
  imageMissing: boolean;
  productUrl: string;
  inStock: boolean;
  rating: number | null;
  unifiedCategory: string;
  unifiedSubcategory: string | null;
  listingType: string | null;
  brand: string | null;
  condition?: string;
  shippingPrice?: number | null;
  location?: string | null;
}

interface FilterOption {
  value: string;
  label: string;
  count?: number;
}

interface FilterGroup {
  key: string;
  title: string;
  type: "single" | "multi" | "range" | "toggle";
  options?: FilterOption[];
  min?: number;
  max?: number;
}

interface CategoryResponse {
  status: "success" | "error";
  items: CatalogProduct[];
  nextCursor: string | null;
  hasMore: boolean;
  total: number;
  categoryResolved: {
    requested: string;
    resolved: string | null;
    resolution: string;
  };
  filters?: FilterGroup[];
  providerStats: ProviderStats;
  warning?: { message: string; code: string; debugId?: string };
  error: { message: string; code: string; debugId?: string } | null;
  durationMs: number;
}

function generateRequestId(): string {
  return crypto.randomUUID().slice(0, 8);
}

// ─── ITEM NORMALIZATION ───────────────────────────────────────────────────────

function normalizeEbayItem(item: NormalizedItem, category: string, subcategory: string | null): CatalogProduct {
  // For list views, only use single main image
  const validatedImageUrl = normalizeAndValidateImageUrl(item.image_url, item.product_url);
  let mainImage = validatedImageUrl;
  
  // Get full images array
  const imagesArray = item.images || item.image_urls || [];
  
  // Fallback to first in image_urls
  if (!mainImage && imagesArray.length > 0) {
    mainImage = normalizeAndValidateImageUrl(imagesArray[0], item.product_url);
  }
  
  const metadata = item.metadata || {};

  return {
    id: item.id,
    provider: item.provider,
    providerProductId: item.provider_product_id,
    title: item.title,
    priceUsd: item.price_usd,
    mainImageUrl: mainImage,
    imageUrl: mainImage,  // Backward compat
    images: imagesArray,
    imageUrls: imagesArray,
    imageCount: item.image_count || imagesArray.length || 1,
    imageMissing: !mainImage,
    productUrl: item.product_url,
    inStock: item.in_stock,
    rating: item.rating,
    unifiedCategory: category,
    unifiedSubcategory: subcategory,
    listingType: item.listing_type,
    brand: item.brand || extractBrand(item.title),
    condition: (metadata.condition as string) || undefined,
    shippingPrice: (metadata.shipping_price as number) || null,
    location: (metadata.location as string) || null,
  };
}

function normalizeDbItem(row: Record<string, unknown>, category: string, subcategory: string | null): CatalogProduct {
  // For list views, only return single main image
  const rawImageUrl = row.image_url as string | null;
  const validatedImageUrl = normalizeAndValidateImageUrl(rawImageUrl, row.product_url as string);
  
  let mainImage = validatedImageUrl;
  
  // Get full images array
  const imagesArray = Array.isArray(row.images) ? row.images.filter((img): img is string => typeof img === "string") : [];
  
  // Fallback to first in images array
  if (!mainImage && imagesArray.length > 0) {
    mainImage = normalizeAndValidateImageUrl(imagesArray[0], row.product_url as string);
  }

  // Compute image count from stored images array or default to 1
  const imageCount = imagesArray.length > 0 ? imagesArray.length : 1;

  return {
    id: row.id as string,
    provider: (row.provider as string) || "unknown",
    providerProductId: (row.provider_product_id as string) || (row.id as string),
    title: (row.title as string) || "",
    priceUsd: row.price_usd as number | null,
    mainImageUrl: mainImage,
    imageUrl: mainImage,  // Backward compat
    images: imagesArray,
    imageUrls: imagesArray,
    imageCount,           // Total images available
    imageMissing: !mainImage,
    productUrl: (row.product_url as string) || "",
    inStock: (row.in_stock as boolean) ?? true,
    rating: row.rating as number | null,
    unifiedCategory: category,
    unifiedSubcategory: subcategory,
    listingType: (row.listing_type as string) || null,
    brand: (row.brand as string) || extractBrand((row.title as string) || ""),
  };
}

// ─── MAIN HANDLER ─────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
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
  const categoryRaw = url.searchParams.get("category") || url.searchParams.get("key") || "";
  const cursor = url.searchParams.get("cursor") || null;
  const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(url.searchParams.get("limit") || String(DEFAULT_LIMIT), 10)));
  const sortParam = url.searchParams.get("sort") || "relevance";
  const sort = validateSort(sortParam);
  const filtersParam = url.searchParams.get("filters") || null;
  const catalogFilters = parseFilters(filtersParam);
  const providerParam = url.searchParams.get("provider") || null;
  const subtabParam = url.searchParams.get("subtab") || null;

  // Build empty provider stats helper
  const buildEmptyProviderStats = (): ProviderStats => buildProviderStats({
    mode: "unknown",
    amazonEnabled: false,
    ebayEnabled: false,
    amazonCacheHit: false,
    amazonBudgetRemaining: null,
    amazonReturned: 0,
    amazonCap: 0,
    amazonStatus: "disabled",
    ebayReturned: 0,
  });

  // Build response helper
  const buildResponse = (
    items: CatalogProduct[],
    total: number,
    hasMore: boolean,
    nextCursor: string | null,
    categoryResolved: CategoryResponse["categoryResolved"],
    providerStats: ProviderStats,
    filters?: FilterGroup[],
    warning?: CategoryResponse["warning"],
    error?: CategoryResponse["error"]
  ): CategoryResponse => ({
    status: error ? "error" : "success",
    items,
    nextCursor,
    hasMore,
    total,
    categoryResolved,
    filters,
    providerStats,
    warning,
    error: error || null,
    durationMs: Date.now() - startTime,
  });

  console.log(`[CATALOG] requestId=${requestId} categoryRequested=${categoryRaw} cursor=${cursor} limit=${limit} env=${envName} provider=${providerParam}`);

  // Validate environment
  if (!ALLOWED_ENVS.includes(envName)) {
    return new Response(
      JSON.stringify(buildResponse([], 0, false, null, 
        { requested: categoryRaw, resolved: null, resolution: "none" },
        buildEmptyProviderStats(),
        undefined, undefined, 
        { message: `Invalid environment: ${envName}`, code: "BAD_ENV", debugId: requestId }
      )),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  if (!categoryRaw) {
    return new Response(
      JSON.stringify(buildResponse([], 0, false, null,
        { requested: "", resolved: null, resolution: "none" },
        buildEmptyProviderStats(),
        undefined, undefined,
        { message: "Missing required 'category' parameter", code: "MISSING_CATEGORY", debugId: requestId }
      )),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // ─── RESOLVE CATEGORY ─────────────────────────────────────────────────────────
  const resolution = resolveCategoryOrError(categoryRaw);
  
  if ("error" in resolution) {
    console.log(`[CATALOG] requestId=${requestId} INVALID_CATEGORY received=${categoryRaw}`);
    return new Response(
      JSON.stringify(buildResponse([], 0, false, null,
        { requested: categoryRaw, resolved: null, resolution: "none" },
        buildEmptyProviderStats(),
        undefined, undefined,
        { 
          message: `Invalid category: "${categoryRaw}". Suggestions: ${resolution.suggestions.join(", ") || "none"}`,
          code: "INVALID_CATEGORY",
          debugId: requestId
        }
      )),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const resolved = resolution as CategoryResolution;
  const canonicalKey = resolved.resolved!;
  const parentTab = resolved.parentTab || canonicalKey;
  // Use subtab from URL param if resolver didn't set one
  const subtabKey = resolved.subtabKey || subtabParam || null;
  const isVehicle = resolved.isVehicle;
  const isParts = resolved.isParts;

  console.log(`[CATALOG] requestId=${requestId} categoryResolved=${canonicalKey} method=${resolved.method} isVehicle=${isVehicle} isParts=${isParts} subtab=${subtabKey}`);

  // Get category metadata
  const meta = getCategoryMeta(canonicalKey);
  const ebayCategory = meta?.ebayCategory || getEbayCategoryId(parentTab) || "";
  const minPrice = meta?.minPrice || getMinPrice(canonicalKey);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseKey) {
      return new Response(
        JSON.stringify(buildResponse([], 0, false, null,
          { requested: categoryRaw, resolved: canonicalKey, resolution: resolved.method },
          buildEmptyProviderStats(),
          undefined, undefined,
          { message: "Backend configuration error", code: "CONFIG_ERROR", debugId: requestId }
        )),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    // Load settings
    const settings = await getCatalogSettings(supabase);
    const effectiveMode = getEffectiveMode(settings, providerParam || undefined);

    console.log(`[CATALOG_MODE] requestId=${requestId} mode=${effectiveMode.mode} amazon=${effectiveMode.amazonActive} ebay=${effectiveMode.ebayActive}`);

    // Decode cursor (use mixer cursor for mixed mode)
    let mixerCursor = getInitialCursor();
    if (cursor) {
      const decoded = decodeMixerCursor(cursor);
      if (decoded) {
        mixerCursor = decoded;
      }
    }

    const page = Math.floor(mixerCursor.ebayOffset / limit) + 1;

    // Initialize provider tracking
    let amazonItems: CatalogProduct[] = [];
    let ebayItems: CatalogProduct[] = [];
    let amazonHasMore = false;
    let ebayHasMore = false;
    let ebayTotal = 0;
    let amazonCacheHit = false;
    let amazonBudgetRemaining: number | null = null;
    let amazonStatus: AmazonStatusInfo["status"] = "disabled";

    // ─── Amazon (DB-cached only) ──────────────────────────────────────────────
    if (effectiveMode.amazonActive && effectiveMode.mode !== "ebay" && !isVehicle) {
      try {
        // Check budget
        const budgetStatus = await checkBudget(
          supabase,
          "amazon",
          settings.amazonBudgetWindow,
          settings.amazonMaxCallsPerHour,
          requestId
        );
        amazonBudgetRemaining = budgetStatus.remaining;

        // Check if cap hit for this category
        const queryCapHit = mixerCursor.amazonReturnedSoFar >= settings.amazonMaxResultsPerQuery;

        if (queryCapHit) {
          amazonStatus = "cap_exhausted";
          console.log(`[CATALOG] requestId=${requestId} Amazon cap exhausted: ${mixerCursor.amazonReturnedSoFar}/${settings.amazonMaxResultsPerQuery}`);
        } else if (!budgetStatus.allowed) {
          amazonStatus = "budget_exceeded";
          console.log(`[AMAZON_BUDGET] requestId=${requestId} Budget exceeded`);
        } else {
          // Derive default Amazon query for category browsing (same as catalog-home see_all.q)
          const defaultAmazonQuery = AMAZON_DEFAULT_QUERIES[canonicalKey] || AMAZON_DEFAULT_QUERIES[parentTab] || null;
          
          // Fetch from DB (cached Amazon data)
          console.log(`[CATALOG] requestId=${requestId} Amazon DB: category="${canonicalKey}" defaultQuery="${defaultAmazonQuery}"`);

          let query = supabase.from("catalog_items").select("*", { count: "exact" });
          query = query.or("provider.eq.rainforest,provider.eq.amazon");
          
          // Include items that match either the category OR have uncategorized but match default query
          // This allows old uncategorized items to still appear while also including properly categorized ones
          if (defaultAmazonQuery) {
            const searchKeywords = defaultAmazonQuery.toLowerCase().split(/\s+/);
            const searchPattern = `%${searchKeywords.join("%")}%`;
            // Match by category OR by search text for uncategorized items
            query = query.or(`unified_category.eq.${parentTab},and(unified_category.is.null,search_text.ilike.${searchPattern}),and(unified_category.eq.uncategorized,search_text.ilike.${searchPattern})`);
          } else {
            query = query.eq("unified_category", parentTab);
          }

          if (subtabKey) {
            query = query.eq("unified_subcategory", subtabKey.replace(`${parentTab}_`, ""));
          }

          query = query.or("is_disallowed.is.null,is_disallowed.eq.false");
          
          // Apply sort based on user preference
          const dbSort = getDbSort(sort);

          const { data: amazonData, count } = await query
            .order(dbSort.column, { ascending: dbSort.ascending, nullsFirst: false })
            .range(
              mixerCursor.amazonReturnedSoFar,
              mixerCursor.amazonReturnedSoFar + limit - 1
            );

          if (amazonData && amazonData.length > 0) {
            // IMPORTANT: Force the resolved unified_category on all returned items
            // This ensures items display correctly even if DB has stale/uncategorized values
            amazonItems = amazonData.map(item => {
              const normalized = normalizeDbItem(
                item as Record<string, unknown>, 
                parentTab, 
                subtabKey ? subtabKey.replace(`${parentTab}_`, "") : null
              );
              // Override unified category with resolved value
              normalized.unifiedCategory = canonicalKey;
              return normalized;
            });
            amazonHasMore = (count || 0) > mixerCursor.amazonReturnedSoFar + amazonData.length;
            amazonCacheHit = true;
            amazonStatus = "cached";
            console.log(`[CATALOG] requestId=${requestId} Amazon DB returned ${amazonItems.length} items`);
          }
        }
      } catch (err) {
        console.error(`[CATALOG] requestId=${requestId} Amazon error:`, err);
        amazonStatus = "error";
      }
    }

    // ─── eBay LIVE Search ─────────────────────────────────────────────────────
    if (effectiveMode.ebayActive && effectiveMode.mode !== "amazon") {
      try {
        const fallbackQueries = isVehicle 
          ? (VEHICLE_FALLBACK_QUERIES[canonicalKey] || VEHICLE_FALLBACK_QUERIES.vehicles_cars_trucks)
          : (CATEGORY_FALLBACK_QUERIES[canonicalKey] || CATEGORY_FALLBACK_QUERIES[parentTab] || ["electronics"]);

        // CRITICAL: For vehicle categories, ALWAYS use a vehicle-specific query
        // Without a query, eBay category 6000 returns all Motors items (parts, equipment, etc.)
        // The query forces search to actual vehicle listings
        const vehicleQuery = isVehicle && !isParts
          ? (VEHICLE_FALLBACK_QUERIES[canonicalKey]?.[0] || "car for sale truck suv sedan coupe")
          : undefined;

        console.log(`[CATALOG] requestId=${requestId} eBay LIVE: category="${canonicalKey}" isVehicle=${isVehicle} vehicleQuery="${vehicleQuery || 'none'}" sort=${sort}`);

        const searchResult = await searchEbayWithFallback(
          supabase,
          {
            query: vehicleQuery, // Force query for vehicles to get real vehicle listings
            categoryId: ebayCategory || undefined,
            page,
            pageSize: limit,
            minPrice: minPrice > 0 ? minPrice : undefined,
            isVehicle,
            isParts,
            marketplaceId: "EBAY_US",
            sort,
            filters: Object.keys(catalogFilters).length > 0 ? catalogFilters : undefined,
          },
          fallbackQueries,
          requestId
        );

        // Apply additional filtering for vehicles
        let filteredItems = searchResult.items;
        if (isVehicle) {
          filteredItems = searchResult.items.filter(item => {
            const filterResult = isAllowedMotorListing({
              title: item.title,
              priceUsd: item.price_usd,
            });
            return filterResult.isAllowed;
          });
        }

        // Filter disallowed content
        filteredItems = filteredItems.filter(item => {
          const blocked = isDisallowedItem({ title: item.title, productUrl: item.product_url });
          return !blocked.isDisallowed;
        });

        // Map to response format
        ebayItems = filteredItems.map(item => 
          normalizeEbayItem(item, parentTab, subtabKey ? subtabKey.replace(`${parentTab}_`, "") : null)
        );
        ebayTotal = searchResult.total;
        ebayHasMore = searchResult.hasMore && (mixerCursor.ebayOffset + limit) < 10000;

        console.log(`[CATALOG] requestId=${requestId} eBay returned ${ebayItems.length} items, total=${ebayTotal}`);

        // Upsert to DB for caching (async, don't wait)
        upsertItemsToDb(supabase, filteredItems, parentTab, subtabKey, requestId);

      } catch (err) {
        console.error(`[CATALOG] requestId=${requestId} eBay error:`, err);
      }
    }

    // ─── DB FALLBACK: if providers returned 0 items, OR if subtab is specified
    //     but eBay (the subtab-aware provider) returned nothing ──
    const totalProviderItems = amazonItems.length + ebayItems.length;
    const needsDbFallback = totalProviderItems === 0 || (subtabKey && ebayItems.length === 0);
    if (needsDbFallback) {
      try {
        const resolvedSub = subtabKey ? subtabKey.replace(`${parentTab}_`, "") : null;
        console.log(`[CATALOG] requestId=${requestId} DB fallback triggered (providerItems=${totalProviderItems}, subtab=${resolvedSub}) for ${canonicalKey}`);
        let dbFallbackQ = supabase.from("catalog_items").select("*")
          .eq("unified_category", parentTab)
          .or("is_disallowed.is.null,is_disallowed.eq.false")
          .neq("image_url", null)
          .gt("price_usd", 0);
        if (resolvedSub) {
          dbFallbackQ = dbFallbackQ.eq("unified_subcategory", resolvedSub);
        }
        const { data: dbFallbackItems } = await dbFallbackQ
          .order("rating", { ascending: false, nullsFirst: false })
          .limit(limit);

        if (dbFallbackItems && dbFallbackItems.length > 0) {
          const mapped = dbFallbackItems.map((item: Record<string, unknown>) => 
            normalizeDbItem(item, parentTab, resolvedSub)
          );
          // Merge with existing results (deduped by id)
          const existingIds = new Set([...amazonItems, ...ebayItems].map((i: any) => i.id));
          const newItems = mapped.filter((i: any) => !existingIds.has(i.id));
          ebayItems = [...ebayItems, ...newItems];
          console.log(`[CATALOG] requestId=${requestId} DB fallback added ${newItems.length} items (total ebay now: ${ebayItems.length})`);
        }
      } catch (dbErr) {
        console.error(`[CATALOG] requestId=${requestId} DB fallback error:`, dbErr);
      }
    }

    // ─── MIX RESULTS ──────────────────────────────────────────────────────────
    // UNIFIED: Use same mixer as catalog-search for consistent behavior

    const mixResult = mixProviderItems({
      amazonItems: amazonItems as ProviderItem[],
      ebayItems: ebayItems as ProviderItem[],
      limit,
      cursor: mixerCursor,
      amazonFirstCount: settings.mixedAmazonFirstCount,
      blendRatio: settings.mixedBlendRatio,
      amazonCap: settings.amazonMaxResultsPerQuery,
      amazonHasMore,
      ebayHasMore,
      categoryKey: canonicalKey,
      requestId,
    });

    // Log mixer debug info (first page only for performance)
    if (!cursor) {
      logMixerDebug(mixResult, requestId, canonicalKey);
    }

    // Final filtering
    const { allowed: filteredItems, removed: removedCount } = filterDisallowedItems(
      mixResult.items.map(item => ({
        ...item,
        title: (item as CatalogProduct).title,
        productUrl: (item as CatalogProduct).productUrl,
      })),
      `[CATALOG] requestId=${requestId}`
    );

    const allowedIds = new Set(filteredItems.map(i => i.id));
    let filteredFinalItems = mixResult.items.filter(item => allowedIds.has(item.id)) as CatalogProduct[];

    // Apply brand diversity to ALL categories (not just clothing)
    // Use category-specific diversity rules:
    // - Electronics (phones, computers, gaming): max 2 per brand for variety
    // - Clothing: max 2 per brand
    // - Vehicles: no diversity (each car is unique)
    // - Other: max 3 per brand (looser diversity)
    if (!isVehicle && mixerCursor.totalReturned === 0 && filteredFinalItems.length > 5) {
      const diversityMaxPerBrand = parentTab.startsWith("electronics") ? 2 
        : parentTab === "clothing_shoes_accessories" ? 2 
        : 3;
      
      filteredFinalItems = applyItemDiversity(filteredFinalItems, {
        maxPerBrand: diversityMaxPerBrand,
        targetCount: limit,
        categoryHint: canonicalKey,
        shuffle: false, // Keep relevance order within brands
      }) as CatalogProduct[];
      
      console.log(`[CATALOG_DIVERSITY] requestId=${requestId} applied diversity maxPerBrand=${diversityMaxPerBrand} items=${filteredFinalItems.length}`);
    }

    // Enrich items with exact image counts from media cache
    const { items: enrichedItems, stats: mediaStats } = await enrichItemsWithMediaCounts(
      supabase,
      filteredFinalItems as unknown as Record<string, unknown>[]
    );

    // Map enriched items back to CatalogProduct type with updated counts
    const finalItems = filteredFinalItems.map((item, idx) => ({
      ...item,
      imageCount: (enrichedItems[idx] as Record<string, unknown>).image_count as number || item.imageCount,
      image_count_status: (enrichedItems[idx] as Record<string, unknown>).image_count_status as string | undefined,
    }));

    console.log(`[CATALOG_MEDIA] requestId=${requestId} checked=${mediaStats.checked} cacheHit=${mediaStats.cacheHit} fetched=${mediaStats.fetched} timeout=${mediaStats.timedOut}`);

    // Build provider stats with mixing configuration for transparency
    const providerStats = buildProviderStats({
      mode: effectiveMode.mode,
      amazonEnabled: effectiveMode.amazonActive,
      ebayEnabled: effectiveMode.ebayActive,
      amazonCacheHit,
      amazonBudgetRemaining,
      amazonReturned: mixResult.amazonReturned,
      amazonCap: settings.amazonMaxResultsPerQuery,
      amazonStatus,
      ebayReturned: mixResult.ebayReturned,
      mixingPhase: mixResult.mixingPhase,
      amazonFirstCount: settings.mixedAmazonFirstCount,
      blendRatio: settings.mixedBlendRatio,
    });

    // Build next cursor
    const nextCursor = mixResult.nextCursor ? encodeMixerCursor(mixResult.nextCursor) : null;

    console.log(`[CATALOG] requestId=${requestId} cursorIn=${cursor} cursorOut=${nextCursor} items=${finalItems.length} hasMore=${mixResult.hasMore} phase=${mixResult.mixingPhase}`);

    // Build filters based on category
    const filters: FilterGroup[] = [
      {
        key: "price",
        title: "Price",
        type: "range",
        min: minPrice,
        max: isVehicle ? 200000 : 10000,
      },
      {
        key: "condition",
        title: "Condition",
        type: "multi",
        options: [
          { value: "new", label: "New" },
          { value: "used", label: "Used" },
          { value: "refurbished", label: "Refurbished" },
        ],
      },
      {
        key: "brand",
        title: "Brand",
        type: "multi",
        options: [
          { value: "apple", label: "Apple" },
          { value: "samsung", label: "Samsung" },
          { value: "nike", label: "Nike" },
          { value: "adidas", label: "Adidas" },
        ],
      },
    ];

    // Get real DB count for this category for accurate total
    let dbCount = 0;
    try {
      const { count } = await supabase
        .from("catalog_items")
        .select("id", { count: "exact", head: true })
        .eq("unified_category", canonicalKey)
        .eq("is_active", true)
        .eq("is_disallowed", false)
        .gt("price_usd", 0);
      dbCount = count || 0;
    } catch (e) {
      console.warn(`[CATALOG] DB count query failed:`, e);
    }

    const realTotal = Math.max(ebayTotal, amazonItems.length, finalItems.length, dbCount);

    return new Response(
      JSON.stringify(buildResponse(
        finalItems, 
        realTotal,
        mixResult.hasMore || finalItems.length < realTotal, 
        nextCursor,
        { requested: categoryRaw, resolved: canonicalKey, resolution: resolved.method },
        providerStats,
        filters,
        undefined
      )),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "Unknown error";
    console.error(`[CATALOG] requestId=${requestId} error:`, errorMessage);

    return new Response(
      JSON.stringify(buildResponse([], 0, false, null,
        { requested: categoryRaw, resolved: canonicalKey, resolution: resolved.method },
        buildEmptyProviderStats(),
        undefined, undefined,
        { message: "Internal error", code: "INTERNAL_ERROR", debugId: requestId }
      )),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
