/**
 * catalog-category
 * Fetches items for a specific category/subtab
 * Uses DB-driven nav configuration (catalog_nav_tabs/subtabs)
 * 
 * ALWAYS returns HTTP 200 with stable JSON:
 * { status: "success", env, category, sub, page, pageSize, total, hasMore, nextOffset, items, error: null }
 * 
 * PROVIDER RULES:
 * - eBay: LIVE + infinite pagination (limit+offset, max 10,000)
 * - Amazon/Rainforest: DB-first only (cached, restricted)
 * 
 * VEHICLES:
 * - ALWAYS use live eBay Browse API
 * - Each subcategory uses correct eBay category_id (from ebay_category_cache)
 * - Strict filters: FIXED_PRICE only, min $1500, exclude parts keywords
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { getEnvironmentFromRequest, EnvironmentName } from "../_shared/environmentResolver.ts";
import { isDisallowedItem } from "../_shared/contentBlocker.ts";
import { searchEbay, searchEbayWithFallback, upsertItemsToDb, NormalizedItem } from "../_shared/ebayBrowseSearch.ts";
import { resolveCategoryId, getCategoryIdForSubtab } from "../_shared/ebayTaxonomy.ts";
import { isAllowedMotorListing, getMinPriceForVehicleSubkey } from "../_shared/motorsFilter.ts";
import { extractBrand, applyBrandDiversity } from "../_shared/brandExtractor.ts";
import { mapCategoryAndSubcategory } from "../_shared/categoryMapper.ts";

const ALLOWED_ENVS: EnvironmentName[] = ["production", "staging"];

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
  home_garden: ["vacuum cleaner", "air fryer", "blender", "power tools"],
  clothing_shoes_accessories: ["sneakers", "hoodie", "jacket", "handbag", "shoes"],
  toys: ["lego set", "kids toy", "rc car", "board game"],
  sporting_goods: ["dumbbells", "soccer ball", "basketball", "yoga mat"],
  business_industrial: ["generator", "air compressor", "commercial equipment"],
  jewelry_watches: ["mens watch", "gold necklace", "diamond ring", "bracelet"],
  refurbished: ["refurbished iphone", "renewed laptop", "certified refurbished"],
  parts_accessories: ["auto parts", "car parts", "brake pads", "oil filter"],
};

interface CatalogItemResponse {
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

interface SubtabConfig {
  key: string;
  parent_key: string;
  ebay_category_hint: string | null;
  min_price_usd: number | null;
  is_vehicle: boolean;
  is_parts: boolean;
  provider_mode: { ebay?: string; amazon?: string };
}

function generateRequestId(): string {
  return crypto.randomUUID().slice(0, 8);
}

function normalizeEbayItem(item: NormalizedItem, category: string, subcategory: string | null): CatalogItemResponse {
  return {
    id: item.id,
    provider: item.provider,
    providerProductId: item.provider_product_id,
    title: item.title,
    priceUsd: item.price_usd,
    imageUrl: item.image_url,
    images: item.images,
    productUrl: item.product_url,
    inStock: item.in_stock,
    rating: item.rating,
    unifiedCategory: category,
    unifiedSubcategory: subcategory,
    listingType: item.listing_type,
    vehiclesSubkey: null,
    partsSubkey: null,
    brand: item.brand,
  };
}

function normalizeDbItem(row: Record<string, unknown>): CatalogItemResponse {
  let images: string[] = [];
  if (Array.isArray(row.images)) {
    images = row.images.filter((img): img is string => typeof img === "string");
  }

  return {
    id: row.id as string,
    provider: (row.provider as string) || "unknown",
    providerProductId: (row.provider_product_id as string) || (row.id as string),
    title: (row.title as string) || "",
    priceUsd: row.price_usd as number | null,
    imageUrl: (row.image_url as string) || (images.length > 0 ? images[0] : null),
    images,
    productUrl: (row.product_url as string) || "",
    inStock: (row.in_stock as boolean) ?? true,
    rating: row.rating as number | null,
    unifiedCategory: (row.unified_category as string) || "electronics",
    unifiedSubcategory: (row.unified_subcategory as string) || null,
    listingType: (row.listing_type as string) || null,
    vehiclesSubkey: (row.vehicles_subkey as string) || null,
    partsSubkey: (row.parts_subkey as string) || null,
    brand: (row.brand as string) || extractBrand((row.title as string) || ""),
  };
}

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
  const subRaw = url.searchParams.get("sub") || null;
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));
  const pageSize = Math.min(50, Math.max(1, parseInt(url.searchParams.get("pageSize") || "20", 10)));
  const mode = url.searchParams.get("mode") || "auto"; // auto | db | live

  // Build response helper
  const buildResponse = (
    items: CatalogItemResponse[],
    total: number,
    hasMore: boolean,
    nextOffset: number | null,
    warning: { message: string; code: string; debugId?: string } | null
  ) => ({
    status: "success" as const,
    env: envName,
    category: categoryRaw,
    sub: subRaw,
    page,
    pageSize,
    total,
    hasMore,
    nextOffset,
    items,
    warning,
    error: null,
    durationMs: Date.now() - startTime,
  });

  console.log(`[CAT_CATEGORY] requestId=${requestId} category=${categoryRaw} sub=${subRaw} page=${page} pageSize=${pageSize} mode=${mode} env=${envName}`);

  // Validate environment
  if (!ALLOWED_ENVS.includes(envName)) {
    return new Response(
      JSON.stringify(buildResponse([], 0, false, null, { message: `Invalid environment: ${envName}`, code: "BAD_ENV", debugId: requestId })),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  if (!categoryRaw) {
    return new Response(
      JSON.stringify(buildResponse([], 0, false, null, { message: "Missing required 'category' parameter", code: "MISSING_CATEGORY", debugId: requestId })),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseKey) {
      return new Response(
        JSON.stringify(buildResponse([], 0, false, null, { message: "Backend configuration error", code: "CONFIG_ERROR", debugId: requestId })),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    // ─── Resolve Category from Nav Tables ─────────────────────────────────────
    let subtabConfig: SubtabConfig | null = null;
    let finalCategory = categoryRaw;
    let effectiveSub = subRaw;

    // Check if this is a subtab key (e.g., vehicles_cars_trucks)
    if (categoryRaw.includes("_")) {
      const { data: subtab } = await supabase
        .from("catalog_nav_subtabs")
        .select("key, parent_key, ebay_category_hint, min_price_usd, is_vehicle, is_parts, provider_mode")
        .eq("key", categoryRaw)
        .single();

      if (subtab) {
        subtabConfig = subtab as SubtabConfig;
        finalCategory = subtab.parent_key;
        effectiveSub = subtab.key.replace(`${subtab.parent_key}_`, "");
        console.log(`[CAT_CATEGORY] requestId=${requestId} resolved subtab: ${categoryRaw} -> parent=${finalCategory}, sub=${effectiveSub}`);
      }
    }

    // If sub is provided, look it up
    if (!subtabConfig && subRaw) {
      const lookupKey = `${categoryRaw}_${subRaw}`;
      const { data: subtab } = await supabase
        .from("catalog_nav_subtabs")
        .select("key, parent_key, ebay_category_hint, min_price_usd, is_vehicle, is_parts, provider_mode")
        .eq("key", lookupKey)
        .single();

      if (subtab) {
        subtabConfig = subtab as SubtabConfig;
        effectiveSub = subRaw;
      }
    }

    // Determine if this is a vehicle or parts category
    const isVehicle = subtabConfig?.is_vehicle || finalCategory === "vehicles";
    const isParts = subtabConfig?.is_parts || finalCategory === "parts_accessories";
    const minPrice = subtabConfig?.min_price_usd || (isVehicle ? 1500 : 0);

    // Get eBay category ID from cache
    let ebayCategory = "";
    if (subtabConfig?.ebay_category_hint) {
      const resolved = await resolveCategoryId(supabase, subtabConfig.ebay_category_hint);
      ebayCategory = resolved.categoryId;
      console.log(`[CAT_CATEGORY] requestId=${requestId} resolved eBay category: ${subtabConfig.ebay_category_hint} -> ${ebayCategory}`);
    }

    // ─── PROVIDER/MODE DECISION ───────────────────────────────────────────────
    // Vehicles: ALWAYS live eBay (no credit worries)
    // Amazon: DB-first only
    const providerMode = subtabConfig?.provider_mode || { ebay: "live", amazon: "db" };
    const forceLive = isVehicle || (mode === "live");
    const effectiveMode = forceLive ? "live" : (mode === "auto" ? (providerMode.ebay || "live") : mode);

    console.log(`[CAT_CATEGORY] requestId=${requestId} finalCategory=${finalCategory} effectiveSub=${effectiveSub} isVehicle=${isVehicle} isParts=${isParts} minPrice=${minPrice} effectiveMode=${effectiveMode} ebayCategory=${ebayCategory}`);

    // ─── LIVE eBay Search ─────────────────────────────────────────────────────
    if (effectiveMode === "live") {
      const fallbackQueries = isVehicle 
        ? (VEHICLE_FALLBACK_QUERIES[categoryRaw] || VEHICLE_FALLBACK_QUERIES.vehicles_cars_trucks)
        : (CATEGORY_FALLBACK_QUERIES[finalCategory] || ["electronics"]);

      const searchResult = await searchEbayWithFallback(
        supabase,
        {
          categoryId: ebayCategory || undefined,
          page,
          pageSize,
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
      const responseItems = filteredItems.map(item => normalizeEbayItem(item, finalCategory, effectiveSub));

      // Upsert to DB for caching (async, don't wait)
      upsertItemsToDb(supabase, filteredItems, finalCategory, effectiveSub, requestId);

      const hasMore = searchResult.hasMore;
      const nextOffset = searchResult.nextOffset;

      console.log(`[CAT_CATEGORY] requestId=${requestId} LIVE eBay: returned=${responseItems.length} total=${searchResult.total} hasMore=${hasMore} nextOffset=${nextOffset}`);

      return new Response(
        JSON.stringify(buildResponse(responseItems, searchResult.total, hasMore, nextOffset, searchResult.warning || null)),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ─── DB Mode ──────────────────────────────────────────────────────────────
    let query = supabase.from("catalog_items").select("*", { count: "exact" });

    // Filter by category
    if (isVehicle) {
      query = query.eq("unified_category", "vehicles");
      if (effectiveSub && effectiveSub !== "all") {
        query = query.eq("vehicles_subkey", effectiveSub);
      }
      query = query.gte("price_usd", minPrice);
    } else if (isParts) {
      query = query.eq("unified_category", "parts_accessories");
      if (effectiveSub) {
        query = query.eq("parts_subkey", effectiveSub);
      }
    } else {
      query = query.eq("unified_category", finalCategory);
      if (effectiveSub) {
        query = query.eq("unified_subcategory", effectiveSub);
      }
    }

    query = query.or("is_disallowed.is.null,is_disallowed.eq.false");

    const { data: dbItems, count: dbCount, error: dbError } = await query
      .order("updated_at", { ascending: false })
      .range((page - 1) * pageSize, page * pageSize - 1);

    if (dbError) {
      console.error(`[CAT_CATEGORY] requestId=${requestId} DB error:`, dbError.message);
      return new Response(
        JSON.stringify(buildResponse([], 0, false, null, { message: "Database error", code: "DB_ERROR", debugId: requestId })),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let items = (dbItems || []).map(row => normalizeDbItem(row as Record<string, unknown>));

    // If DB is empty and page 1, fallback to live
    if (items.length === 0 && page === 1) {
      console.log(`[CAT_CATEGORY] requestId=${requestId} DB empty, falling back to live eBay`);
      
      const fallbackQueries = CATEGORY_FALLBACK_QUERIES[finalCategory] || ["electronics"];
      const searchResult = await searchEbayWithFallback(
        supabase,
        { page: 1, pageSize, marketplaceId: "EBAY_US" },
        fallbackQueries,
        requestId
      );

      items = searchResult.items.map(item => normalizeEbayItem(item, finalCategory, effectiveSub));
      upsertItemsToDb(supabase, searchResult.items, finalCategory, effectiveSub, requestId);
    }

    // Apply brand diversity for clothing
    if (finalCategory === "clothing_shoes_accessories" && page === 1 && items.length > 5) {
      items = applyBrandDiversity(items, 2, pageSize);
    }

    const total = dbCount || items.length;
    const hasMore = (dbCount || 0) > page * pageSize;
    const nextOffset = hasMore ? page * pageSize : null;

    console.log(`[CAT_CATEGORY] requestId=${requestId} DB: returned=${items.length} total=${total} hasMore=${hasMore}`);

    return new Response(
      JSON.stringify(buildResponse(items, total, hasMore, nextOffset, null)),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "Unknown error";
    console.error(`[CAT_CATEGORY] requestId=${requestId} error:`, errorMessage);

    return new Response(
      JSON.stringify(buildResponse([], 0, false, null, { message: "Internal error", code: "INTERNAL_ERROR", debugId: requestId })),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
