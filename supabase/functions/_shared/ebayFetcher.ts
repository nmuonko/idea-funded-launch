/**
 * eBay Fetcher - Shared eBay search logic
 * Used by catalog-search and catalog-category
 */

// Use 'any' type to avoid importing the Supabase SDK (prevents bundle bloat)
type SupabaseClientAny = any;

import { searchEbay, NormalizedItem } from "./ebayBrowseSearch.ts";
import { mapCategoryAndSubcategory } from "./categoryMapper.ts";
import { isAllowedMotorListing } from "./motorsFilter.ts";
import { CatalogFilters } from "./sortFilterNormalizer.ts";
import { CatalogItem, mapEbayItemToResponse } from "./catalogItemMapper.ts";

export interface EbayFetchParams {
  supabase: SupabaseClientAny;
  query: string;
  effectiveMode: { ebayActive: boolean; mode: string };
  isVehicle: boolean;
  hasBuyingIntent: boolean;
  isHeavyEquipment?: boolean;
  categoryKey: string | undefined;
  page: number;
  limit: number;
  catalogFilters: CatalogFilters;
  requestId: string;
}

export interface EbayFetchResult {
  items: CatalogItem[];
  hasMore: boolean;
  total: number;
  rawCount?: number;
  mappedCount?: number;
  filteredCount?: number;
  failOpenUsed?: boolean;
}

const CATEGORY_MAPPING: Record<string, string> = {
  electronics_phones: "9355",
  electronics_gaming: "139971",   // "Video Game Consoles" leaf (not broad 1249)
  gaming: "139971",               // Console-only category
  electronics_computers: "58058",
  electronics_cameras: "625",
  electronics_audio: "3253",
  clothing_shoes_accessories: "63889",
  home_garden: "11700",
  vehicles: "6001",          // Cars & Trucks listings only (was 6000 which includes parts)
  vehicles_cars_trucks: "6001",
  vehicles_motorcycles: "6024",   // Motorcycles category
  vehicles_powersports: "6024",   // Same as motorcycles
  refurbished: "11800",
  parts_accessories: "6028",
  sporting_goods: "888",
  toys: "220",
  jewelry_watches: "281",
};

// Vehicle model normalization — standalone model names → brand + model
const VEHICLE_MODEL_NORMALIZE: Record<string, string> = {
  "land cruiser": "Toyota Land Cruiser",
  "landcruiser": "Toyota Land Cruiser",
  "prado": "Toyota Prado",
  "hilux": "Toyota Hilux",
  "rav4": "Toyota RAV4",
  "corolla": "Toyota Corolla",
  "camry": "Toyota Camry",
  "highlander": "Toyota Highlander",
  "civic": "Honda Civic",
  "accord": "Honda Accord",
  "cr-v": "Honda CR-V",
  "crv": "Honda CR-V",
  "pilot": "Honda Pilot",
};

export async function fetchEbayItems(params: EbayFetchParams): Promise<EbayFetchResult> {
  const { supabase, query, effectiveMode, isVehicle, hasBuyingIntent, isHeavyEquipment, categoryKey, page, limit, catalogFilters, requestId } = params;

  let items: CatalogItem[] = [];
  let hasMore = false;
  let total = 0;

  if (!effectiveMode.ebayActive || effectiveMode.mode === "amazon") {
    return { items, hasMore, total };
  }

  try {
    // Post-fetch vehicle guardrails handle parts filtering — no pre-fetch price gating
    const minPrice = undefined;
    console.log(`[EBAY_FETCH] requestId=${requestId} minPrice=${minPrice} (hasBuyingIntent=${hasBuyingIntent} isHeavyEquipment=${!!isHeavyEquipment})`);

    // Map category_key to eBay category ID
    let ebayCategory: string | undefined;
    if (categoryKey) {
      ebayCategory = CATEGORY_MAPPING[categoryKey];
    }

    // Normalize standalone model names to brand + model for better eBay results
    let enhancedQuery = query;
    const qLow = query.toLowerCase().trim();
    for (const [model, fullName] of Object.entries(VEHICLE_MODEL_NORMALIZE)) {
      // Only normalize if the query doesn't already contain the brand
      const brand = fullName.split(" ")[0].toLowerCase();
      if (qLow.includes(model) && !qLow.includes(brand)) {
        enhancedQuery = query.replace(new RegExp(model, "i"), fullName);
        console.log(`[EBAY_FETCH] requestId=${requestId} vehicle_model_normalize: "${query}" → "${enhancedQuery}"`);
        break;
      }
    }

    // Detect motorcycle/scooter queries and force Motorcycles category
    const qLower = enhancedQuery.toLowerCase();
    const MOTO_TERMS = ["motorcycle","moto ","motorbike","scooter","125cc","150cc","250cc","cg 125","cg125","dirt bike"];
    const isMotorcycleQuery = MOTO_TERMS.some(t => qLower.includes(t));
    
    // Force eBay Motors category for vehicle buying intent, but NOT for heavy equipment
    if (isMotorcycleQuery && !ebayCategory) {
      ebayCategory = "6024"; // Motorcycles
      console.log(`[EBAY_FETCH] requestId=${requestId} Motorcycle query, forcing category=6024`);
    } else if (hasBuyingIntent && !ebayCategory && !isHeavyEquipment) {
      ebayCategory = "6001"; // Cars & Trucks (more specific than 6000 for better results)
      console.log(`[EBAY_FETCH] requestId=${requestId} Vehicle BUYING intent, forcing category=6001 (Cars & Trucks)`);
    } else if (isHeavyEquipment) {
      console.log(`[EBAY_FETCH] requestId=${requestId} Heavy equipment query - searching all categories (no category restriction)`);
    } else if (isVehicle && !hasBuyingIntent) {
      console.log(`[EBAY_FETCH] requestId=${requestId} Vehicle brand but no buying intent - all categories`);
    }

    console.log(`[EBAY_FETCH] requestId=${requestId} LIVE: q="${enhancedQuery}" isVehicle=${isVehicle} hasBuyingIntent=${hasBuyingIntent} minPrice=${minPrice} ebayCategory=${ebayCategory}`);

    const ebayResult = await searchEbay(
      supabase,
      {
        query: enhancedQuery,
        page,
        pageSize: limit,
        minPrice,
        isVehicle,
        isHeavyEquipment,
        categoryId: ebayCategory,
        marketplaceId: "EBAY_US",
        filters: catalogFilters,
      },
      requestId
    );

    const rawCount = ebayResult.items.length;

    if (rawCount > 0) {
      let filteredItems = ebayResult.items;

      // Filter vehicles — SKIP strict motorsFilter for heavy equipment
      // Heavy equipment (tractors, excavators) legitimately has "engine", "transmission" etc. in titles
      if (isVehicle && !isHeavyEquipment) {
        filteredItems = filteredItems.filter(item => {
          const result = isAllowedMotorListing({ title: item.title, priceUsd: item.price_usd });
          return result.isAllowed;
        });
      } else if (isHeavyEquipment) {
        // For heavy equipment: only require title + price + image (light filter)
        filteredItems = filteredItems.filter(item => {
          if (!item.title || item.title.length < 5) return false;
          if (!item.price_usd || item.price_usd <= 0) return false;
          // Use any available image
          if (!item.image_url && (!item.images || item.images.length === 0)) return false;
          return true;
        });
        console.log(`[EBAY_FETCH] requestId=${requestId} HEAVY_EQUIPMENT light filter: ${rawCount} → ${filteredItems.length}`);
      }

      const mappedCount = filteredItems.length;

      // FAIL-OPEN: if filtering removed ALL items but raw had items, return unfiltered (with basic quality gate)
      let failOpenUsed = false;
      if (mappedCount === 0 && rawCount > 0) {
        console.log(`[EBAY_FETCH] requestId=${requestId} FAIL_OPEN: filtering removed all ${rawCount} items, returning with basic quality gate`);
        filteredItems = ebayResult.items.filter(item =>
          item.title && item.title.length > 3 &&
          item.price_usd !== null && item.price_usd > 0
        );
        failOpenUsed = true;
      }

      items = filteredItems.map(mapEbayItemToResponse);
      total = ebayResult.total;
      hasMore = ebayResult.hasMore;

      console.log(`[EBAY_FETCH] requestId=${requestId} raw=${rawCount} filtered=${mappedCount} final=${items.length} failOpen=${failOpenUsed} total=${total}`);

      // Upsert to DB (async, don't wait)
      const toUpsert = filteredItems.map(item => {
        const { category, subcategory } = mapCategoryAndSubcategory({
          title: item.title, provider: "ebay", productUrl: item.product_url,
        });

        return {
          id: item.id, provider: "ebay",
          provider_product_id: item.provider_product_id,
          title: item.title, price_usd: item.price_usd,
          image_url: item.image_url, images: item.images,
          product_url: item.product_url, in_stock: item.in_stock,
          rating: item.rating,
          unified_category: category !== "blocked" ? category : "electronics",
          unified_subcategory: subcategory,
          updated_at: new Date().toISOString(),
        };
      });

      supabase.from("catalog_items").upsert(toUpsert, { onConflict: "id" });

      return { items, hasMore, total, rawCount, mappedCount, filteredCount: items.length, failOpenUsed };
    }
  } catch (err) {
    console.error(`[EBAY_FETCH] requestId=${requestId} error:`, err);
  }

  return { items, hasMore, total };
}
