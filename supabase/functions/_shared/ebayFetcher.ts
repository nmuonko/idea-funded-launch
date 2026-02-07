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
}

const CATEGORY_MAPPING: Record<string, string> = {
  electronics_phones: "9355",
  electronics_gaming: "1249",
  electronics_computers: "58058",
  electronics_cameras: "625",
  electronics_audio: "3253",
  clothing_shoes_accessories: "63889",
  home_garden: "11700",
  vehicles_cars_trucks: "6001",
  refurbished: "11800",
  parts_accessories: "6028",
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
    // VEHICLE MODE LOGIC: Enforce minPrice ONLY when user has buying intent AND not heavy equipment
    const minPrice = (hasBuyingIntent && !isHeavyEquipment) ? 1000 : undefined;
    console.log(`[EBAY_FETCH] requestId=${requestId} minPrice=${minPrice} (hasBuyingIntent=${hasBuyingIntent} isHeavyEquipment=${!!isHeavyEquipment})`);
    
    // Map category_key to eBay category ID
    let ebayCategory: string | undefined;
    if (categoryKey) {
      ebayCategory = CATEGORY_MAPPING[categoryKey];
    }

    // Force eBay Motors category for vehicle buying intent, but NOT for heavy equipment
    const enhancedQuery = query;
    if (hasBuyingIntent && !ebayCategory && !isHeavyEquipment) {
      ebayCategory = "6001"; // Cars & Trucks
      console.log(`[EBAY_FETCH] requestId=${requestId} Vehicle BUYING intent, forcing category=6001`);
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
        categoryId: ebayCategory,
        marketplaceId: "EBAY_US",
        filters: catalogFilters,
      },
      requestId
    );

    if (ebayResult.items.length > 0) {
      let filteredItems = ebayResult.items;

      // Filter vehicles
      if (isVehicle) {
        filteredItems = filteredItems.filter(item => {
          const result = isAllowedMotorListing({ title: item.title, priceUsd: item.price_usd });
          return result.isAllowed;
        });
      }

      items = filteredItems.map(mapEbayItemToResponse);
      total = ebayResult.total;
      hasMore = ebayResult.hasMore;

      console.log(`[EBAY_FETCH] requestId=${requestId} returned ${items.length} items, total=${total}`);

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
    }
  } catch (err) {
    console.error(`[EBAY_FETCH] requestId=${requestId} error:`, err);
  }

  return { items, hasMore, total };
}
