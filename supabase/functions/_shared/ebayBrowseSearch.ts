/**
 * eBay Browse API Search Helper
 * Provides live eBay search with proper pagination (limit+offset)
 * and vehicle filtering rules
 */

import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

// eBay Browse API constants
const EBAY_BROWSE_API = "https://api.ebay.com/buy/browse/v1/item_summary/search";
const EBAY_MAX_OFFSET = 10000; // eBay API limit
const EBAY_MAX_LIMIT = 50; // eBay API max per request
const DEFAULT_LIMIT = 20;

// Parts keywords to exclude from vehicle searches
const PARTS_DENY_KEYWORDS = [
  "tpms", "sensor", "valve stem", "valve cap", "hubcap", "hub cap",
  "wheel cover", "rim cover", "floor mat", "floor liner", "seat cover",
  "dash cover", "car cover", "bra", "mud flap", "splash guard",
  "emblem", "badge", "decal", "sticker", "antenna", "mast",
  "mirror", "side mirror", "wiper blade", "wiper arm", "windshield",
  "brake pad", "brake rotor", "brake caliper", "brake line",
  "oil filter", "air filter", "cabin filter", "fuel filter",
  "spark plug", "ignition coil", "alternator", "starter",
  "radiator", "thermostat", "water pump", "coolant",
  "belt", "serpentine", "timing belt", "timing chain",
  "gasket", "seal", "o-ring", "bearing", "bushing",
  "shock", "strut", "spring", "control arm", "ball joint",
  "tie rod", "sway bar", "link", "mount", "bracket",
  "exhaust", "muffler", "catalytic", "pipe", "clamp",
  "light bulb", "headlight bulb", "tail light", "turn signal",
  "fuse", "relay", "switch", "connector", "harness",
  "battery", "terminal", "cable", "ground strap",
  "key", "remote", "fob", "transponder", "immobilizer",
  "manual", "repair manual", "service manual", "owner manual",
  "tool", "wrench", "socket", "jack", "stand",
  "cargo", "trunk", "organizer", "net", "tray",
  "phone mount", "cup holder", "ashtray", "visor",
  "floor jack", "car jack", "lug wrench", "torque wrench",
  "oem", "aftermarket", "replacement", "compatible",
  "for", "fits", "compatible with", "replacement for",
];

// Vehicle signal keywords (title should have these for vehicles)
const VEHICLE_SIGNAL_KEYWORDS = [
  "sedan", "coupe", "suv", "truck", "van", "wagon",
  "convertible", "hatchback", "crossover", "minivan",
  "pickup", "4x4", "4wd", "awd", "rwd", "fwd",
  "automatic", "manual transmission", "cvt",
  "miles", "mileage", "odometer", "clean title",
  "salvage", "rebuilt", "runs", "drives", "no reserve",
];

export interface EbaySearchParams {
  query?: string;
  categoryId?: string;
  page?: number;
  pageSize?: number;
  minPrice?: number;
  maxPrice?: number;
  isVehicle?: boolean;
  isParts?: boolean;
  marketplaceId?: string;
}

export interface EbaySearchResult {
  items: NormalizedItem[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
  nextOffset: number | null;
  warning?: { message: string; code: string };
}

export interface NormalizedItem {
  id: string;
  title: string;
  price_usd: number | null;
  currency: string;
  image_url: string | null;
  images: string[];
  product_url: string;
  provider: string;
  provider_product_id: string;
  in_stock: boolean;
  rating: number | null;
  brand: string | null;
  category_key: string | null;
  listing_type: string | null;
  buying_options: string[];
  metadata: Record<string, unknown>;
}

/**
 * Get eBay OAuth token
 */
async function getEbayToken(): Promise<string | null> {
  const clientId = Deno.env.get("EBAY_CLIENT_ID");
  const clientSecret = Deno.env.get("EBAY_CLIENT_SECRET");

  if (!clientId || !clientSecret) {
    console.error("[EBAY_BROWSE] Missing EBAY_CLIENT_ID or EBAY_CLIENT_SECRET");
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
      const errorText = await response.text();
      console.error("[EBAY_BROWSE] Token error:", response.status, errorText);
      return null;
    }

    const data = await response.json();
    return data.access_token;
  } catch (error) {
    console.error("[EBAY_BROWSE] Token fetch error:", error);
    return null;
  }
}

/**
 * Check if a title contains parts keywords
 */
function containsPartsKeywords(title: string): boolean {
  const lowerTitle = title.toLowerCase();
  return PARTS_DENY_KEYWORDS.some(keyword => lowerTitle.includes(keyword.toLowerCase()));
}

/**
 * Check if a title has vehicle signals
 */
function hasVehicleSignals(title: string): boolean {
  const lowerTitle = title.toLowerCase();
  return VEHICLE_SIGNAL_KEYWORDS.some(keyword => lowerTitle.includes(keyword.toLowerCase()));
}

/**
 * Normalize eBay item to standard format
 */
function normalizeEbayItem(item: Record<string, unknown>, categoryKey: string | null): NormalizedItem {
  const price = item.price as Record<string, unknown> | undefined;
  const priceValue = price?.value ? parseFloat(price.value as string) : null;
  const currency = (price?.currency as string) || "USD";

  const image = item.image as Record<string, unknown> | undefined;
  const imageUrl = image?.imageUrl as string | null;
  
  const thumbnailImages = item.thumbnailImages as Array<Record<string, unknown>> | undefined;
  const images = thumbnailImages?.map(img => img.imageUrl as string).filter(Boolean) || [];
  if (imageUrl && !images.includes(imageUrl)) {
    images.unshift(imageUrl);
  }

  const buyingOptions = (item.buyingOptions as string[]) || [];
  const itemWebUrl = item.itemWebUrl as string || "";
  const itemId = item.itemId as string || "";

  return {
    id: `ebay_${itemId}`,
    title: (item.title as string) || "",
    price_usd: currency === "USD" ? priceValue : priceValue, // TODO: convert other currencies
    currency,
    image_url: imageUrl,
    images,
    product_url: itemWebUrl,
    provider: "ebay",
    provider_product_id: itemId,
    in_stock: true,
    rating: null,
    brand: null,
    category_key: categoryKey,
    listing_type: buyingOptions.includes("FIXED_PRICE") ? "buy_it_now" : "auction",
    buying_options: buyingOptions,
    metadata: {
      condition: item.condition,
      conditionId: item.conditionId,
      seller: item.seller,
      itemLocation: item.itemLocation,
      shippingOptions: item.shippingOptions,
      categories: item.categories,
    },
  };
}

/**
 * Build eBay search URL with filters
 */
function buildSearchUrl(params: EbaySearchParams, offset: number): string {
  const url = new URL(EBAY_BROWSE_API);
  
  // Query
  if (params.query) {
    url.searchParams.set("q", params.query);
  }
  
  // Category ID (only one allowed per request)
  if (params.categoryId) {
    url.searchParams.set("category_ids", params.categoryId);
  }
  
  // Pagination
  const limit = Math.min(params.pageSize || DEFAULT_LIMIT, EBAY_MAX_LIMIT);
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("offset", String(offset));
  
  // Build filter string
  const filters: string[] = [];
  
  // Buy It Now only (FIXED_PRICE) - exclude auctions
  filters.push("buyingOptions:{FIXED_PRICE}");
  
  // Price filter
  if (params.minPrice !== undefined && params.minPrice > 0) {
    filters.push(`price:[${params.minPrice}..],priceCurrency:USD`);
  }
  
  // US items preferred
  filters.push("itemLocationCountry:US");
  
  if (filters.length > 0) {
    url.searchParams.set("filter", filters.join(","));
  }
  
  return url.toString();
}

/**
 * Search eBay Browse API with proper pagination
 */
export async function searchEbay(
  supabase: SupabaseClient,
  params: EbaySearchParams,
  requestId: string
): Promise<EbaySearchResult> {
  const page = params.page || 1;
  const pageSize = Math.min(params.pageSize || DEFAULT_LIMIT, EBAY_MAX_LIMIT);
  const offset = (page - 1) * pageSize;
  
  // Check eBay offset limit
  if (offset >= EBAY_MAX_OFFSET) {
    console.log(`[EBAY_BROWSE] requestId=${requestId} offset=${offset} exceeds max ${EBAY_MAX_OFFSET}, returning empty`);
    return {
      items: [],
      total: EBAY_MAX_OFFSET,
      page,
      pageSize,
      hasMore: false,
      nextOffset: null,
      warning: { message: "Maximum pagination limit reached", code: "MAX_OFFSET" },
    };
  }
  
  const token = await getEbayToken();
  if (!token) {
    console.error(`[EBAY_BROWSE] requestId=${requestId} No token available`);
    return {
      items: [],
      total: 0,
      page,
      pageSize,
      hasMore: false,
      nextOffset: null,
      warning: { message: "eBay authentication failed", code: "AUTH_ERROR" },
    };
  }
  
  const searchUrl = buildSearchUrl(params, offset);
  console.log(`[EBAY_BROWSE] requestId=${requestId} url=${searchUrl}`);
  
  try {
    const response = await fetch(searchUrl, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${token}`,
        "X-EBAY-C-MARKETPLACE-ID": params.marketplaceId || "EBAY_US",
        "Content-Type": "application/json",
      },
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[EBAY_BROWSE] requestId=${requestId} API error: ${response.status} ${errorText}`);
      return {
        items: [],
        total: 0,
        page,
        pageSize,
        hasMore: false,
        nextOffset: null,
        warning: { message: `eBay API error: ${response.status}`, code: "API_ERROR" },
      };
    }
    
    const data = await response.json();
    const rawItems = (data.itemSummaries || []) as Array<Record<string, unknown>>;
    const total = data.total || 0;
    
    console.log(`[EBAY_BROWSE] requestId=${requestId} rawCount=${rawItems.length} total=${total}`);
    
    // Filter and normalize items
    let items = rawItems.map(item => normalizeEbayItem(item, params.categoryId || null));
    
    // Apply vehicle-specific filtering
    if (params.isVehicle && !params.isParts) {
      const beforeCount = items.length;
      items = items.filter(item => {
        // Exclude items with parts keywords
        if (containsPartsKeywords(item.title)) {
          return false;
        }
        return true;
      });
      const blockedCount = beforeCount - items.length;
      if (blockedCount > 0) {
        console.log(`[EBAY_BROWSE] requestId=${requestId} VEHICLE_BLOCK blocked=${blockedCount} items with parts keywords`);
      }
    }
    
    // Calculate pagination
    const nextOffset = offset + pageSize;
    const hasMore = nextOffset < Math.min(total, EBAY_MAX_OFFSET) && items.length > 0;
    
    console.log(`[EBAY_BROWSE] requestId=${requestId} finalCount=${items.length} page=${page} hasMore=${hasMore} nextOffset=${hasMore ? nextOffset : null}`);
    
    return {
      items,
      total: Math.min(total, EBAY_MAX_OFFSET),
      page,
      pageSize,
      hasMore,
      nextOffset: hasMore ? nextOffset : null,
    };
  } catch (error) {
    console.error(`[EBAY_BROWSE] requestId=${requestId} fetch error:`, error);
    return {
      items: [],
      total: 0,
      page,
      pageSize,
      hasMore: false,
      nextOffset: null,
      warning: { message: "eBay search failed", code: "FETCH_ERROR" },
    };
  }
}

/**
 * Search eBay with fallback queries if primary returns empty
 */
export async function searchEbayWithFallback(
  supabase: SupabaseClient,
  params: EbaySearchParams,
  fallbackQueries: string[],
  requestId: string
): Promise<EbaySearchResult> {
  // Try primary search
  const result = await searchEbay(supabase, params, requestId);
  
  if (result.items.length > 0 || fallbackQueries.length === 0) {
    return result;
  }
  
  // Try fallback queries
  console.log(`[EBAY_BROWSE] requestId=${requestId} Primary search empty, trying fallbacks`);
  
  for (const query of fallbackQueries) {
    const fallbackResult = await searchEbay(
      supabase,
      { ...params, query },
      requestId
    );
    
    if (fallbackResult.items.length > 0) {
      console.log(`[EBAY_BROWSE] requestId=${requestId} Fallback query="${query}" returned ${fallbackResult.items.length} items`);
      return fallbackResult;
    }
  }
  
  // All fallbacks failed
  return result;
}

/**
 * Upsert search results to catalog_items for DB caching
 */
export async function upsertItemsToDb(
  supabase: SupabaseClient,
  items: NormalizedItem[],
  unifiedCategory: string | null,
  unifiedSubcategory: string | null,
  requestId: string
): Promise<void> {
  if (items.length === 0) return;
  
  try {
    const records = items.map(item => ({
      id: item.id,
      title: item.title,
      price_usd: item.price_usd,
      image_url: item.image_url,
      images: item.images,
      product_url: item.product_url,
      provider: item.provider,
      provider_product_id: item.provider_product_id,
      in_stock: item.in_stock,
      rating: item.rating,
      brand: item.brand,
      category_key: item.category_key,
      unified_category: unifiedCategory,
      unified_subcategory: unifiedSubcategory,
      buying_options: item.buying_options,
      listing_type: item.listing_type === "buy_it_now" ? "vehicle" : item.listing_type,
      metadata: item.metadata,
      updated_at: new Date().toISOString(),
    }));
    
    const { error } = await supabase
      .from("catalog_items")
      .upsert(records, { onConflict: "id" });
    
    if (error) {
      console.error(`[EBAY_BROWSE] requestId=${requestId} upsert error:`, error);
    } else {
      console.log(`[EBAY_BROWSE] requestId=${requestId} upserted ${records.length} items to DB`);
    }
  } catch (error) {
    console.error(`[EBAY_BROWSE] requestId=${requestId} upsert exception:`, error);
  }
}
