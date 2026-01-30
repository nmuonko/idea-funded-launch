/**
 * catalog-category
 * Fetches items for a specific category/subtab with cursor-based pagination
 * Uses canonical category registry for alias resolution
 * 
 * ALWAYS returns HTTP 200 with stable JSON:
 * { 
 *   status: "success", 
 *   items, 
 *   nextCursor, 
 *   hasMore, 
 *   categoryResolved: { requested, resolved, resolution },
 *   filters?,
 *   error: null 
 * }
 * 
 * PROVIDER RULES:
 * - eBay: LIVE + infinite pagination (limit+offset, max 10,000)
 * - Amazon/Rainforest: DB-first only (cached, restricted)
 * 
 * VEHICLES:
 * - ALWAYS use live eBay Browse API
 * - Each subcategory uses correct eBay category_id
 * - Strict filters: FIXED_PRICE only, min price, exclude parts keywords
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { getEnvironmentFromRequest, EnvironmentName } from "../_shared/environmentResolver.ts";
import { isDisallowedItem } from "../_shared/contentBlocker.ts";
import { searchEbay, searchEbayWithFallback, upsertItemsToDb, NormalizedItem } from "../_shared/ebayBrowseSearch.ts";
import { isAllowedMotorListing } from "../_shared/motorsFilter.ts";
import { extractBrand, applyBrandDiversity } from "../_shared/brandExtractor.ts";
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

const ALLOWED_ENVS: EnvironmentName[] = ["production", "staging"];
const DEFAULT_LIMIT = 24;
const MAX_LIMIT = 60;

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
  vehicles: ["car for sale truck suv sedan coupe", "toyota camry", "honda accord"],
  vehicles_all: ["car for sale truck suv sedan coupe", "toyota camry", "honda accord", "ford f150"],
  vehicles_cars_trucks: ["used car for sale sedan suv", "toyota camry", "honda accord", "chevrolet silverado"],
  vehicles_motorcycles: ["motorcycle for sale", "harley davidson", "honda goldwing", "yamaha"],
  vehicles_powersports: ["atv quad 4 wheeler", "polaris sportsman", "side by side utv"],
  vehicles_boats: ["boat for sale", "bass tracker", "pontoon boat", "fishing boat"],
  vehicles_rvs_campers: ["rv motorhome", "travel trailer", "fifth wheel camper"],
  vehicles_trailers_other: ["utility trailer", "cargo trailer", "enclosed trailer"],
  vehicles_classic_cars: ["classic car for sale", "vintage mustang", "classic corvette"],
};

const CATEGORY_FALLBACK_QUERIES: Record<string, string[]> = {
  electronics: ["iphone", "samsung phone", "laptop", "headphones"],
  electronics_phones: ["iphone 15", "samsung galaxy", "google pixel"],
  electronics_computers: ["laptop", "macbook", "gaming laptop", "desktop computer"],
  electronics_gaming: ["ps5 console", "xbox series x", "nintendo switch"],
  electronics_cameras: ["dslr camera", "gopro", "mirrorless camera"],
  electronics_audio: ["airpods", "bose headphones", "jbl speaker"],
  home_garden: ["vacuum cleaner", "air fryer", "blender", "power tools"],
  clothing_shoes_accessories: ["sneakers", "hoodie", "jacket", "handbag", "shoes"],
  clothing_men: ["men hoodie", "men jacket", "men jeans", "men shirt"],
  clothing_women: ["women dress", "women jacket", "women blouse"],
  clothing_shoes: ["nike shoes", "adidas sneakers", "boots"],
  clothing_bags: ["handbag", "backpack", "crossbody bag"],
  toys: ["lego set", "kids toy", "rc car", "board game"],
  sporting_goods: ["dumbbells", "soccer ball", "basketball", "yoga mat"],
  business_industrial: ["generator", "air compressor", "commercial equipment"],
  jewelry_watches: ["mens watch", "gold necklace", "diamond ring", "bracelet"],
  refurbished: ["refurbished iphone", "renewed laptop", "certified refurbished"],
  parts_accessories: ["auto parts", "car parts", "brake pads", "oil filter"],
  vehicles_parts_accessories: ["car parts", "auto parts", "brake pads", "oil filter"],
};

// ─── CURSOR ENCODING ──────────────────────────────────────────────────────────

interface CursorData {
  offset: number;
  provider: "ebay" | "db";
}

function encodeCursor(data: CursorData): string {
  return btoa(JSON.stringify(data));
}

function decodeCursor(cursor: string): CursorData | null {
  try {
    const decoded = atob(cursor);
    const data = JSON.parse(decoded);
    if (typeof data.offset === "number" && typeof data.provider === "string") {
      return data as CursorData;
    }
    return null;
  } catch {
    return null;
  }
}

// ─── RESPONSE TYPES ───────────────────────────────────────────────────────────

interface CatalogProduct {
  id: string;
  provider: string;
  providerProductId: string;
  title: string;
  priceUsd: number | null;
  imageUrl: string | null;
  imageMissing: boolean;
  images: string[];
  productUrl: string;
  inStock: boolean;
  rating: number | null;
  unifiedCategory: string;
  unifiedSubcategory: string | null;
  listingType: string | null;
  brand: string | null;
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
  warning?: { message: string; code: string; debugId?: string };
  error: { message: string; code: string; debugId?: string } | null;
  durationMs: number;
}

function generateRequestId(): string {
  return crypto.randomUUID().slice(0, 8);
}

// ─── ITEM NORMALIZATION ───────────────────────────────────────────────────────

function normalizeEbayItem(item: NormalizedItem, category: string, subcategory: string | null): CatalogProduct {
  // Validate image URL
  const validatedImageUrl = normalizeAndValidateImageUrl(item.image_url, item.product_url);
  const validatedImages = item.images
    .map(img => normalizeAndValidateImageUrl(img, item.product_url))
    .filter((img): img is string => img !== null);

  return {
    id: item.id,
    provider: item.provider,
    providerProductId: item.provider_product_id,
    title: item.title,
    priceUsd: item.price_usd,
    imageUrl: validatedImageUrl || (validatedImages.length > 0 ? validatedImages[0] : null),
    imageMissing: !validatedImageUrl && validatedImages.length === 0,
    images: validatedImages,
    productUrl: item.product_url,
    inStock: item.in_stock,
    rating: item.rating,
    unifiedCategory: category,
    unifiedSubcategory: subcategory,
    listingType: item.listing_type,
    brand: item.brand || extractBrand(item.title),
  };
}

function normalizeDbItem(row: Record<string, unknown>, category: string, subcategory: string | null): CatalogProduct {
  let images: string[] = [];
  if (Array.isArray(row.images)) {
    images = row.images
      .filter((img): img is string => typeof img === "string")
      .map(img => normalizeAndValidateImageUrl(img, row.product_url as string))
      .filter((img): img is string => img !== null);
  }

  const rawImageUrl = row.image_url as string | null;
  const validatedImageUrl = normalizeAndValidateImageUrl(rawImageUrl, row.product_url as string);

  return {
    id: row.id as string,
    provider: (row.provider as string) || "unknown",
    providerProductId: (row.provider_product_id as string) || (row.id as string),
    title: (row.title as string) || "",
    priceUsd: row.price_usd as number | null,
    imageUrl: validatedImageUrl || (images.length > 0 ? images[0] : null),
    imageMissing: !validatedImageUrl && images.length === 0,
    images,
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
  const sort = url.searchParams.get("sort") || "relevance";
  const filtersParam = url.searchParams.get("filters") || null;

  // Build response helper
  const buildResponse = (
    items: CatalogProduct[],
    total: number,
    hasMore: boolean,
    nextCursor: string | null,
    categoryResolved: CategoryResponse["categoryResolved"],
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
    warning,
    error: error || null,
    durationMs: Date.now() - startTime,
  });

  console.log(`[CATALOG] requestId=${requestId} categoryRequested=${categoryRaw} cursor=${cursor} limit=${limit} env=${envName}`);

  // Validate environment
  if (!ALLOWED_ENVS.includes(envName)) {
    return new Response(
      JSON.stringify(buildResponse([], 0, false, null, 
        { requested: categoryRaw, resolved: null, resolution: "none" },
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
  const subtabKey = resolved.subtabKey;
  const isVehicle = resolved.isVehicle;
  const isParts = resolved.isParts;

  console.log(`[CATALOG] requestId=${requestId} categoryResolved=${canonicalKey} method=${resolved.method} isVehicle=${isVehicle} isParts=${isParts}`);

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
          undefined, undefined,
          { message: "Backend configuration error", code: "CONFIG_ERROR", debugId: requestId }
        )),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    // Decode cursor
    let offset = 0;
    let provider: "ebay" | "db" = isVehicle ? "ebay" : "db";
    
    if (cursor) {
      const cursorData = decodeCursor(cursor);
      if (cursorData) {
        offset = cursorData.offset;
        provider = cursorData.provider;
      }
    }

    const page = Math.floor(offset / limit) + 1;

    // ─── LIVE eBay Search (for vehicles or explicit live mode) ────────────────
    if (isVehicle || provider === "ebay") {
      const fallbackQueries = isVehicle 
        ? (VEHICLE_FALLBACK_QUERIES[canonicalKey] || VEHICLE_FALLBACK_QUERIES.vehicles_cars_trucks)
        : (CATEGORY_FALLBACK_QUERIES[canonicalKey] || CATEGORY_FALLBACK_QUERIES[parentTab] || ["electronics"]);

      const searchResult = await searchEbayWithFallback(
        supabase,
        {
          categoryId: ebayCategory || undefined,
          page,
          pageSize: limit,
          minPrice: minPrice > 0 ? minPrice : undefined,
          isVehicle,
          isParts,
          marketplaceId: "EBAY_US",
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
      const responseItems = filteredItems.map(item => 
        normalizeEbayItem(item, parentTab, subtabKey ? subtabKey.replace(`${parentTab}_`, "") : null)
      );

      // Upsert to DB for caching (async, don't wait)
      upsertItemsToDb(supabase, filteredItems, parentTab, subtabKey, requestId);

      // Build next cursor
      const newOffset = offset + limit;
      const hasMore = searchResult.hasMore && newOffset < 10000;
      const nextCursor = hasMore ? encodeCursor({ offset: newOffset, provider: "ebay" }) : null;

      console.log(`[CATALOG] requestId=${requestId} cursorIn=${cursor} cursorOut=${nextCursor} items=${responseItems.length} hasMore=${hasMore}`);

      // Build basic filters for eBay results
      const filters: FilterGroup[] = [
        {
          key: "price",
          title: "Price",
          type: "range",
          min: minPrice,
          max: 100000,
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
      ];

      return new Response(
        JSON.stringify(buildResponse(
          responseItems, 
          searchResult.total, 
          hasMore, 
          nextCursor,
          { requested: categoryRaw, resolved: canonicalKey, resolution: resolved.method },
          filters,
          searchResult.warning || undefined
        )),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ─── DB Mode ──────────────────────────────────────────────────────────────
    let query = supabase.from("catalog_items").select("*", { count: "exact" });

    // Filter by category
    if (isParts) {
      query = query.eq("unified_category", "parts_accessories");
      if (subtabKey) {
        query = query.eq("parts_subkey", subtabKey.replace("parts_", ""));
      }
    } else {
      query = query.eq("unified_category", parentTab);
      if (subtabKey) {
        query = query.eq("unified_subcategory", subtabKey.replace(`${parentTab}_`, ""));
      }
    }

    query = query.or("is_disallowed.is.null,is_disallowed.eq.false");

    const { data: dbItems, count: dbCount, error: dbError } = await query
      .order("updated_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (dbError) {
      console.error(`[CATALOG] requestId=${requestId} DB error:`, dbError.message);
      return new Response(
        JSON.stringify(buildResponse([], 0, false, null,
          { requested: categoryRaw, resolved: canonicalKey, resolution: resolved.method },
          undefined, undefined,
          { message: "Database error", code: "DB_ERROR", debugId: requestId }
        )),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let items = (dbItems || []).map(row => 
      normalizeDbItem(row as Record<string, unknown>, parentTab, subtabKey ? subtabKey.replace(`${parentTab}_`, "") : null)
    );

    // If DB is empty and offset is 0, fallback to live eBay
    if (items.length === 0 && offset === 0) {
      console.log(`[CATALOG] requestId=${requestId} [CATEGORY_FALLBACK] DB empty, switching to live eBay`);
      
      const fallbackQueries = CATEGORY_FALLBACK_QUERIES[canonicalKey] || CATEGORY_FALLBACK_QUERIES[parentTab] || ["electronics"];
      const searchResult = await searchEbayWithFallback(
        supabase,
        { 
          categoryId: ebayCategory || undefined,
          page: 1, 
          pageSize: limit, 
          marketplaceId: "EBAY_US" 
        },
        fallbackQueries,
        requestId
      );

      items = searchResult.items.map(item => 
        normalizeEbayItem(item, parentTab, subtabKey ? subtabKey.replace(`${parentTab}_`, "") : null)
      );
      upsertItemsToDb(supabase, searchResult.items, parentTab, subtabKey, requestId);
    }

    // Apply brand diversity for clothing
    if (parentTab === "clothing_shoes_accessories" && offset === 0 && items.length > 5) {
      items = applyBrandDiversity(items, 2, limit) as CatalogProduct[];
    }

    const total = dbCount || items.length;
    const newOffset = offset + limit;
    const hasMore = (dbCount || 0) > newOffset;
    const nextCursor = hasMore ? encodeCursor({ offset: newOffset, provider: "db" }) : null;

    console.log(`[CATALOG] requestId=${requestId} cursorIn=${cursor} cursorOut=${nextCursor} items=${items.length} hasMore=${hasMore}`);

    // Build filters based on category
    const filters: FilterGroup[] = [
      {
        key: "price",
        title: "Price",
        type: "range",
        min: 0,
        max: 10000,
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

    return new Response(
      JSON.stringify(buildResponse(
        items, 
        total, 
        hasMore, 
        nextCursor,
        { requested: categoryRaw, resolved: canonicalKey, resolution: resolved.method },
        filters
      )),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "Unknown error";
    console.error(`[CATALOG] requestId=${requestId} error:`, errorMessage);

    return new Response(
      JSON.stringify(buildResponse([], 0, false, null,
        { requested: categoryRaw, resolved: canonicalKey, resolution: resolved.method },
        undefined, undefined,
        { message: "Internal error", code: "INTERNAL_ERROR", debugId: requestId }
      )),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
