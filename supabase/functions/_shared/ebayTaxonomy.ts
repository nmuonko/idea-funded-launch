/**
 * eBay Taxonomy Resolver
 * Resolves category hints (e.g., "Cars & Trucks") to eBay category IDs
 * Uses ebay_category_cache table for caching (7-day TTL)
 */

import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

// Default marketplace
const DEFAULT_MARKETPLACE = "EBAY_US";

// Fallback category IDs if cache miss and API fails
const FALLBACK_CATEGORY_IDS: Record<string, string> = {
  "Motors": "6000",
  "Cars & Trucks": "6001",
  "Motorcycles": "6024",
  "Powersports": "66466",
  "Boats": "26429",
  "RVs & Campers": "50054",
  "Trailers & Other Vehicles": "6038",
  "Classic Cars": "6001",
  "Parts & Accessories": "6028",
  "Cell Phones & Smartphones": "9355",
  "Computers/Tablets & Networking": "58058",
  "Video Games & Consoles": "1249",
  "Cameras & Photo": "625",
  "Consumer Electronics": "293",
  "Men's Clothing": "1059",
  "Women's Clothing": "15724",
  "Shoes": "63889",
  "Bags & Accessories": "169291",
  "Home & Garden": "11700",
  "Toys & Hobbies": "220",
  "Sporting Goods": "888",
  "Business & Industrial": "12576",
  "Jewelry & Watches": "281",
};

export interface CategoryResolution {
  categoryId: string;
  categoryName: string;
  fromCache: boolean;
  marketplaceId: string;
}

/**
 * Get eBay OAuth token for API calls
 */
async function getEbayToken(): Promise<string | null> {
  const clientId = Deno.env.get("EBAY_CLIENT_ID");
  const clientSecret = Deno.env.get("EBAY_CLIENT_SECRET");

  if (!clientId || !clientSecret) {
    console.error("[EBAY_TAXONOMY] Missing EBAY_CLIENT_ID or EBAY_CLIENT_SECRET");
    return null;
  }

  try {
    const credentials = btoa(`${clientId}:${clientSecret}`);
    const response = await fetch("https://api.ebay.com/identity/v1/oauth2/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Authorization": `Basic ${credentials}`,
      },
      body: "grant_type=client_credentials&scope=https://api.ebay.com/oauth/api_scope",
    });

    if (!response.ok) {
      console.error("[EBAY_TAXONOMY] Token request failed:", response.status);
      return null;
    }

    const data = await response.json();
    return data.access_token;
  } catch (error) {
    console.error("[EBAY_TAXONOMY] Token error:", error);
    return null;
  }
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
 * 1. Check cache first
 * 2. If not found, use fallback (API call can be added later)
 * 3. Cache the result
 */
export async function resolveCategoryId(
  supabase: SupabaseClient,
  hint: string,
  marketplaceId: string = DEFAULT_MARKETPLACE
): Promise<CategoryResolution> {
  // Check cache first
  const cached = await getCachedCategoryId(supabase, hint, marketplaceId);
  if (cached) {
    return cached;
  }

  console.log(`[EBAY_TAXONOMY] Cache MISS for hint="${hint}"`);

  // Use fallback mapping
  const fallbackId = FALLBACK_CATEGORY_IDS[hint];
  if (fallbackId) {
    // Cache the fallback for future use
    await setCachedCategoryId(supabase, hint, fallbackId, hint, marketplaceId);
    
    return {
      categoryId: fallbackId,
      categoryName: hint,
      fromCache: false,
      marketplaceId,
    };
  }

  // If no fallback, try to fetch from Taxonomy API (optional enhancement)
  // For now, return a generic category
  console.warn(`[EBAY_TAXONOMY] No fallback for hint="${hint}", using generic search`);
  
  return {
    categoryId: "", // Empty means no category filter, will search broadly
    categoryName: hint,
    fromCache: false,
    marketplaceId,
  };
}

/**
 * Get category ID for a subtab key
 */
export async function getCategoryIdForSubtab(
  supabase: SupabaseClient,
  subtabKey: string
): Promise<CategoryResolution | null> {
  try {
    // Look up the subtab to get the ebay_category_hint
    const { data: subtab, error } = await supabase
      .from("catalog_nav_subtabs")
      .select("ebay_category_hint, title_en")
      .eq("key", subtabKey)
      .single();

    if (error || !subtab?.ebay_category_hint) {
      console.warn(`[EBAY_TAXONOMY] No category hint for subtab="${subtabKey}"`);
      return null;
    }

    return await resolveCategoryId(supabase, subtab.ebay_category_hint);
  } catch (error) {
    console.error(`[EBAY_TAXONOMY] Error resolving subtab="${subtabKey}":`, error);
    return null;
  }
}

/**
 * Get category ID for a tab key (uses the tab's default category)
 */
export async function getCategoryIdForTab(
  supabase: SupabaseClient,
  tabKey: string
): Promise<CategoryResolution | null> {
  // Map tab keys to eBay category hints
  const tabToHint: Record<string, string> = {
    "electronics": "Consumer Electronics",
    "vehicles": "Motors",
    "home_garden": "Home & Garden",
    "clothing_shoes_accessories": "Shoes", // Use shoes as default
    "toys": "Toys & Hobbies",
    "sporting_goods": "Sporting Goods",
    "business_industrial": "Business & Industrial",
    "jewelry_watches": "Jewelry & Watches",
    "refurbished": "Consumer Electronics", // Refurbished electronics
    "parts_accessories": "Parts & Accessories",
  };

  const hint = tabToHint[tabKey];
  if (!hint) {
    console.warn(`[EBAY_TAXONOMY] No hint mapping for tab="${tabKey}"`);
    return null;
  }

  return await resolveCategoryId(supabase, hint);
}
