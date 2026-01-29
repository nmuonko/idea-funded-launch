/**
 * catalog-category
 * Fetches items for a specific category/subtab
 * 
 * ALL CATEGORIES use eBay LIVE with infinite pagination (limit+offset, max 10,000)
 * Amazon/Rainforest remains DB-only (cached, restricted)
 * 
 * ALWAYS returns HTTP 200 with stable JSON:
 * { status: "success", env, category, sub, page, pageSize, total, hasMore, nextOffset, items, error: null }
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { getEnvironmentFromRequest, EnvironmentName } from "../_shared/environmentResolver.ts";
import { isDisallowedItem } from "../_shared/contentBlocker.ts";
import { searchEbay, upsertItemsToDb, NormalizedItem } from "../_shared/ebayBrowseSearch.ts";
import { getCategoryForTabKey, getCategoryForSubtabKey, resolveCategoryId } from "../_shared/ebayTaxonomy.ts";
import { isAllowedMotorListing } from "../_shared/motorsFilter.ts";
import { extractBrand, applyBrandDiversity } from "../_shared/brandExtractor.ts";

const ALLOWED_ENVS: EnvironmentName[] = ["production", "staging"];

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, apikey, content-type, x-client-info, x-device-id, x-afrishop-environment",
  "Access-Control-Max-Age": "86400",
  "Cache-Control": "public, max-age=120",
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
  const mode = url.searchParams.get("mode") || "live"; // Default to LIVE for all eBay categories
  const query = url.searchParams.get("q") || null; // Optional search query within category

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

    // ─── Resolve Category ─────────────────────────────────────────────────────
    let finalCategory = categoryRaw;
    let effectiveSub = subRaw;
    let ebayCategory = "";
    let minPrice = 0;
    let isVehicle = false;
    let isParts = false;

    // Check if this is a full subtab key (e.g., vehicles_cars_trucks)
    if (categoryRaw.includes("_")) {
      const subtabMapping = getCategoryForSubtabKey(categoryRaw);
      if (subtabMapping) {
        ebayCategory = subtabMapping.categoryId;
        minPrice = subtabMapping.minPrice || 0;
        
        // Parse parent and sub from the key
        const parts = categoryRaw.split("_");
        finalCategory = parts[0];
        effectiveSub = parts.slice(1).join("_");
        
        isVehicle = finalCategory === "vehicles" && effectiveSub !== "parts_accessories";
        isParts = categoryRaw.includes("parts");
        
        console.log(`[CAT_CATEGORY] requestId=${requestId} Resolved subtab: ${categoryRaw} -> categoryId=${ebayCategory}, minPrice=${minPrice}`);
      }
    }

    // If no subtab mapping, try tab mapping
    if (!ebayCategory) {
      const tabMapping = getCategoryForTabKey(categoryRaw);
      if (tabMapping) {
        ebayCategory = tabMapping.categoryId;
        finalCategory = categoryRaw;
        console.log(`[CAT_CATEGORY] requestId=${requestId} Resolved tab: ${categoryRaw} -> categoryId=${ebayCategory}`);
      }
    }

    // If still no mapping, check if sub is provided separately
    if (!ebayCategory && subRaw) {
      const combinedKey = `${categoryRaw}_${subRaw}`;
      const subtabMapping = getCategoryForSubtabKey(combinedKey);
      if (subtabMapping) {
        ebayCategory = subtabMapping.categoryId;
        minPrice = subtabMapping.minPrice || 0;
        effectiveSub = subRaw;
        
        isVehicle = categoryRaw === "vehicles" && subRaw !== "parts_accessories";
        isParts = subRaw.includes("parts");
        
        console.log(`[CAT_CATEGORY] requestId=${requestId} Resolved combined: ${combinedKey} -> categoryId=${ebayCategory}`);
      }
    }

    // Final fallback: resolve from hint
    if (!ebayCategory) {
      const resolved = await resolveCategoryId(supabase, categoryRaw);
      ebayCategory = resolved.categoryId;
      console.log(`[CAT_CATEGORY] requestId=${requestId} Resolved via hint: ${categoryRaw} -> categoryId=${ebayCategory}`);
    }

    // Determine vehicle/parts status
    if (!isVehicle && !isParts) {
      isVehicle = finalCategory === "vehicles" || categoryRaw.startsWith("vehicles");
      isParts = finalCategory === "parts_accessories" || categoryRaw.includes("parts");
    }

    // Set min price for vehicles
    if (isVehicle && minPrice === 0) {
      minPrice = 1500;
    }

    console.log(`[CAT_CATEGORY] requestId=${requestId} Final: category=${finalCategory} sub=${effectiveSub} ebayCategory=${ebayCategory} isVehicle=${isVehicle} isParts=${isParts} minPrice=${minPrice}`);

    // ─── ALWAYS USE eBay LIVE (default behavior) ─────────────────────────────
    // mode=db is only for debugging/admin use
    if (mode !== "db") {
      console.log(`[CAT_CATEGORY] requestId=${requestId} EBAY LIVE mode: categoryId=${ebayCategory} page=${page}`);

      const searchResult = await searchEbay(
        supabase,
        {
          query: query || undefined,
          categoryId: ebayCategory || undefined,
          page,
          pageSize,
          minPrice: minPrice > 0 ? minPrice : undefined,
          isVehicle,
          isParts,
          marketplaceId: "EBAY_US",
        },
        requestId
      );

      // Apply additional filtering
      let filteredItems = searchResult.items;

      // Vehicle-specific filtering
      if (isVehicle && !isParts) {
        const beforeCount = filteredItems.length;
        filteredItems = filteredItems.filter(item => {
          const filterResult = isAllowedMotorListing({
            title: item.title,
            priceUsd: item.price_usd,
          });
          return filterResult.isAllowed;
        });
        const blockedCount = beforeCount - filteredItems.length;
        if (blockedCount > 0) {
          console.log(`[CAT_CATEGORY] requestId=${requestId} VEHICLE_FILTER blocked=${blockedCount} items`);
        }
      }

      // Content filter (no books, subscriptions, etc.)
      filteredItems = filteredItems.filter(item => {
        const blocked = isDisallowedItem({ title: item.title, productUrl: item.product_url });
        return !blocked.isDisallowed;
      });

      // Map to response format
      let responseItems = filteredItems.map(item => normalizeEbayItem(item, finalCategory, effectiveSub));

      // Apply brand diversity for clothing
      if (finalCategory === "clothing_shoes_accessories" && page === 1 && responseItems.length > 5) {
        responseItems = applyBrandDiversity(responseItems, 2, pageSize);
      }

      // Upsert to DB for caching (async, don't wait)
      upsertItemsToDb(supabase, filteredItems, finalCategory, effectiveSub, requestId);

      const hasMore = searchResult.hasMore;
      const nextOffset = searchResult.nextOffset;

      console.log(`[CAT_CATEGORY] requestId=${requestId} LIVE result: returned=${responseItems.length} total=${searchResult.total} hasMore=${hasMore} nextOffset=${nextOffset}`);

      return new Response(
        JSON.stringify(buildResponse(responseItems, searchResult.total, hasMore, nextOffset, searchResult.warning || null)),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ─── DB Mode (for debugging only) ─────────────────────────────────────────
    console.log(`[CAT_CATEGORY] requestId=${requestId} DB mode (debug only)`);
    
    let dbQuery = supabase.from("catalog_items").select("*", { count: "exact" });

    // Filter by category
    if (isVehicle) {
      dbQuery = dbQuery.eq("unified_category", "vehicles");
      if (effectiveSub && effectiveSub !== "all") {
        dbQuery = dbQuery.eq("vehicles_subkey", effectiveSub);
      }
      dbQuery = dbQuery.gte("price_usd", minPrice);
    } else if (isParts) {
      dbQuery = dbQuery.eq("unified_category", "parts_accessories");
      if (effectiveSub) {
        dbQuery = dbQuery.eq("parts_subkey", effectiveSub);
      }
    } else {
      dbQuery = dbQuery.eq("unified_category", finalCategory);
      if (effectiveSub) {
        dbQuery = dbQuery.eq("unified_subcategory", effectiveSub);
      }
    }

    dbQuery = dbQuery.or("is_disallowed.is.null,is_disallowed.eq.false");

    const { data: dbItems, count: dbCount, error: dbError } = await dbQuery
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

    // If DB is empty, fallback to live
    if (items.length === 0 && page === 1) {
      console.log(`[CAT_CATEGORY] requestId=${requestId} DB empty, falling back to live eBay`);
      
      const searchResult = await searchEbay(
        supabase,
        {
          categoryId: ebayCategory || undefined,
          page: 1,
          pageSize,
          minPrice: minPrice > 0 ? minPrice : undefined,
          isVehicle,
          isParts,
          marketplaceId: "EBAY_US",
        },
        requestId
      );

      items = searchResult.items.map(item => normalizeEbayItem(item, finalCategory, effectiveSub));
      upsertItemsToDb(supabase, searchResult.items, finalCategory, effectiveSub, requestId);
    }

    const total = dbCount || items.length;
    const hasMore = (dbCount || 0) > page * pageSize;
    const nextOffset = hasMore ? page * pageSize : null;

    console.log(`[CAT_CATEGORY] requestId=${requestId} DB result: returned=${items.length} total=${total} hasMore=${hasMore}`);

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
