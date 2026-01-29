/**
 * eBay Taxonomy Resolver
 * Resolves category hints (e.g., "Cars & Trucks") to eBay category IDs
 * Uses ebay_category_cache table for caching (7-day TTL)
 * 
 * ALL tabs use eBay LIVE with proper category IDs for broad inventory
 */

import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

// Default marketplace
const DEFAULT_MARKETPLACE = "EBAY_US";

// Complete eBay category ID mapping for all top-level tabs
// These IDs are from eBay's official category taxonomy
const EBAY_CATEGORY_IDS: Record<string, string> = {
  // Top-level tabs
  "Electronics": "293",
  "Consumer Electronics": "293",
  "Cell Phones & Smartphones": "9355",
  "Computers/Tablets & Networking": "58058",
  "Video Games & Consoles": "1249",
  "Cameras & Photo": "625",
  "TV, Audio & Surveillance": "32852",
  
  // Home & Garden
  "Home & Garden": "11700",
  "Home Improvement": "159907",
  "Kitchen, Dining & Bar": "20625",
  "Yard, Garden & Outdoor Living": "159912",
  "Tools & Workshop Equipment": "631",
  
  // Clothing, Shoes & Accessories
  "Clothing, Shoes & Accessories": "11450",
  "Men's Clothing": "1059",
  "Women's Clothing": "15724",
  "Shoes": "63889",
  "Bags & Accessories": "169291",
  "Fashion": "11450",
  
  // Toys
  "Toys": "220",
  "Toys & Hobbies": "220",
  "Action Figures": "246",
  "Building Toys": "18996",
  
  // Sporting Goods
  "Sporting Goods": "888",
  "Outdoor Sports": "159043",
  "Fitness, Running & Yoga": "15273",
  "Cycling": "7294",
  
  // Business & Industrial
  "Business & Industrial": "12576",
  "Heavy Equipment": "11765",
  "Office Equipment & Supplies": "28073",
  
  // Jewelry & Watches
  "Jewelry & Watches": "281",
  "Fine Jewelry": "4195",
  "Watches, Parts & Accessories": "260324",
  "Men's Jewelry": "175756",
  
  // Refurbished
  "Refurbished": "293", // Use Electronics as base for refurbished
  "Certified Refurbished": "293",
  
  // Parts & Accessories (vehicle parts)
  "Parts & Accessories": "6028",
  "Car and Truck Parts": "6030",
  "Motorcycle Parts": "10063",
  "Auto Parts & Accessories": "6028",
  
  // Motors/Vehicles
  "Motors": "6000",
  "Vehicles": "6000",
  "Cars & Trucks": "6001",
  "Motorcycles": "6024",
  "Powersports": "66466",
  "Boats": "26429",
  "RVs and Campers": "50054",
  "RVs & Campers": "50054",
  "Trailers and Other Vehicles": "6038",
  "Trailers & Other Vehicles": "6038",
  "Classic Cars": "6001", // Same as Cars & Trucks, filtered by condition/year
  "Commercial Trucks": "63732",
};

// Tab key to eBay category mapping (for direct tab lookups)
const TAB_KEY_TO_CATEGORY: Record<string, { categoryId: string; hint: string }> = {
  electronics: { categoryId: "293", hint: "Consumer Electronics" },
  vehicles: { categoryId: "6000", hint: "Motors" },
  home_garden: { categoryId: "11700", hint: "Home & Garden" },
  clothing_shoes_accessories: { categoryId: "11450", hint: "Clothing, Shoes & Accessories" },
  toys: { categoryId: "220", hint: "Toys & Hobbies" },
  sporting_goods: { categoryId: "888", hint: "Sporting Goods" },
  business_industrial: { categoryId: "12576", hint: "Business & Industrial" },
  jewelry_watches: { categoryId: "281", hint: "Jewelry & Watches" },
  refurbished: { categoryId: "293", hint: "Consumer Electronics" }, // Refurb uses electronics + condition filter
  parts_accessories: { categoryId: "6028", hint: "Auto Parts & Accessories" },
};

// Subtab key to eBay category mapping
const SUBTAB_KEY_TO_CATEGORY: Record<string, { categoryId: string; hint: string; minPrice?: number }> = {
  // Vehicle subtabs
  vehicles_all: { categoryId: "6000", hint: "Motors", minPrice: 1500 },
  vehicles_cars_trucks: { categoryId: "6001", hint: "Cars & Trucks", minPrice: 1500 },
  vehicles_motorcycles: { categoryId: "6024", hint: "Motorcycles", minPrice: 800 },
  vehicles_powersports: { categoryId: "66466", hint: "Powersports", minPrice: 500 },
  vehicles_boats: { categoryId: "26429", hint: "Boats", minPrice: 1000 },
  vehicles_rvs_campers: { categoryId: "50054", hint: "RVs & Campers", minPrice: 2000 },
  vehicles_trailers_other: { categoryId: "6038", hint: "Trailers & Other Vehicles", minPrice: 500 },
  vehicles_classic_cars: { categoryId: "6001", hint: "Classic Cars", minPrice: 5000 },
  vehicles_parts_accessories: { categoryId: "6028", hint: "Auto Parts & Accessories" },
  
  // Electronics subtabs
  electronics_phones: { categoryId: "9355", hint: "Cell Phones & Smartphones" },
  electronics_gaming: { categoryId: "1249", hint: "Video Games & Consoles" },
  electronics_computers: { categoryId: "58058", hint: "Computers/Tablets & Networking" },
  electronics_cameras: { categoryId: "625", hint: "Cameras & Photo" },
  electronics_audio: { categoryId: "3283", hint: "Portable Audio & Headphones" },
  
  // Clothing subtabs
  clothing_mens: { categoryId: "1059", hint: "Men's Clothing" },
  clothing_womens: { categoryId: "15724", hint: "Women's Clothing" },
  clothing_shoes: { categoryId: "63889", hint: "Shoes" },
  clothing_bags: { categoryId: "169291", hint: "Bags & Accessories" },
};

export interface CategoryResolution {
  categoryId: string;
  categoryName: string;
  fromCache: boolean;
  marketplaceId: string;
  minPrice?: number;
}

/**
 * Check cache for category ID
 */
async function getCachedCategoryId(
  supabase: SupabaseClient,
  hint: string,
  marketplaceId: string = DEFAULT_MARKETPLACE
): Promise<CategoryResolution | null> {
  try {
    const { data, error } = await supabase
      .from("ebay_category_cache")
      .select("category_id, category_name")
      .eq("marketplace_id", marketplaceId)
      .eq("hint", hint)
      .gt("expires_at", new Date().toISOString())
      .single();

    if (error || !data) {
      return null;
    }

    console.log(`[EBAY_TAXONOMY] Cache HIT for hint="${hint}" -> categoryId=${data.category_id}`);
    return {
      categoryId: data.category_id,
      categoryName: data.category_name || hint,
      fromCache: true,
      marketplaceId,
    };
  } catch {
    return null;
  }
}

/**
 * Store resolved category in cache
 */
async function setCachedCategoryId(
  supabase: SupabaseClient,
  hint: string,
  categoryId: string,
  categoryName: string,
  marketplaceId: string = DEFAULT_MARKETPLACE
): Promise<void> {
  try {
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7); // 7-day TTL

    await supabase
      .from("ebay_category_cache")
      .upsert({
        marketplace_id: marketplaceId,
        hint,
        category_id: categoryId,
        category_name: categoryName,
        updated_at: new Date().toISOString(),
        expires_at: expiresAt.toISOString(),
      }, { onConflict: "marketplace_id,hint" });

    console.log(`[EBAY_TAXONOMY] Cached hint="${hint}" -> categoryId=${categoryId}`);
  } catch (error) {
    console.error("[EBAY_TAXONOMY] Cache write error:", error);
  }
}

/**
 * Resolve a category hint to an eBay category ID
 * 1. Check static mapping first (fast path)
 * 2. Check cache
 * 3. Fallback to empty (broad search)
 */
export async function resolveCategoryId(
  supabase: SupabaseClient,
  hint: string,
  marketplaceId: string = DEFAULT_MARKETPLACE
): Promise<CategoryResolution> {
  // 1. Check static mapping first (instant)
  const staticId = EBAY_CATEGORY_IDS[hint];
  if (staticId) {
    console.log(`[EBAY_TAXONOMY] Static HIT for hint="${hint}" -> categoryId=${staticId}`);
    // Cache it for future reference
    setCachedCategoryId(supabase, hint, staticId, hint, marketplaceId);
    return {
      categoryId: staticId,
      categoryName: hint,
      fromCache: false,
      marketplaceId,
    };
  }

  // 2. Check cache
  const cached = await getCachedCategoryId(supabase, hint, marketplaceId);
  if (cached) {
    return cached;
  }

  console.log(`[EBAY_TAXONOMY] No mapping for hint="${hint}", will use broad search`);
  
  // 3. Return empty to allow keyword-based search
  return {
    categoryId: "",
    categoryName: hint,
    fromCache: false,
    marketplaceId,
  };
}

/**
 * Get category info for a tab key (e.g., "electronics", "vehicles")
 */
export function getCategoryForTabKey(tabKey: string): { categoryId: string; hint: string } | null {
  const mapping = TAB_KEY_TO_CATEGORY[tabKey];
  if (mapping) {
    console.log(`[EBAY_TAXONOMY] Tab "${tabKey}" -> categoryId=${mapping.categoryId}`);
    return mapping;
  }
  console.warn(`[EBAY_TAXONOMY] No mapping for tab="${tabKey}"`);
  return null;
}

/**
 * Get category info for a subtab key (e.g., "vehicles_cars_trucks")
 */
export function getCategoryForSubtabKey(subtabKey: string): { categoryId: string; hint: string; minPrice?: number } | null {
  const mapping = SUBTAB_KEY_TO_CATEGORY[subtabKey];
  if (mapping) {
    console.log(`[EBAY_TAXONOMY] Subtab "${subtabKey}" -> categoryId=${mapping.categoryId}, minPrice=${mapping.minPrice || 0}`);
    return mapping;
  }
  console.warn(`[EBAY_TAXONOMY] No mapping for subtab="${subtabKey}"`);
  return null;
}

/**
 * Get category ID for a subtab from database
 */
export async function getCategoryIdForSubtab(
  supabase: SupabaseClient,
  subtabKey: string
): Promise<CategoryResolution | null> {
  // First check static mapping
  const staticMapping = getCategoryForSubtabKey(subtabKey);
  if (staticMapping) {
    return {
      categoryId: staticMapping.categoryId,
      categoryName: staticMapping.hint,
      fromCache: false,
      marketplaceId: DEFAULT_MARKETPLACE,
      minPrice: staticMapping.minPrice,
    };
  }

  // Fallback to database lookup
  try {
    const { data: subtab, error } = await supabase
      .from("catalog_nav_subtabs")
      .select("ebay_category_hint, title_en, min_price_usd")
      .eq("key", subtabKey)
      .single();

    if (error || !subtab?.ebay_category_hint) {
      console.warn(`[EBAY_TAXONOMY] No category hint for subtab="${subtabKey}"`);
      return null;
    }

    const resolved = await resolveCategoryId(supabase, subtab.ebay_category_hint);
    return {
      ...resolved,
      minPrice: subtab.min_price_usd || undefined,
    };
  } catch (error) {
    console.error(`[EBAY_TAXONOMY] Error resolving subtab="${subtabKey}":`, error);
    return null;
  }
}

/**
 * Get category ID for a tab key
 */
export async function getCategoryIdForTab(
  supabase: SupabaseClient,
  tabKey: string
): Promise<CategoryResolution | null> {
  // First check static mapping
  const staticMapping = getCategoryForTabKey(tabKey);
  if (staticMapping) {
    return {
      categoryId: staticMapping.categoryId,
      categoryName: staticMapping.hint,
      fromCache: false,
      marketplaceId: DEFAULT_MARKETPLACE,
    };
  }

  // Fallback to resolveCategoryId with the tab key
  return await resolveCategoryId(supabase, tabKey);
}
