/**
 * eBay Browse API Search Helper
 * Provides live eBay search with proper pagination (limit+offset)
 * and vehicle filtering rules
 */

// Use 'any' type to avoid importing the Supabase SDK (prevents bundle bloat)
type SupabaseClient = any;

// eBay Browse API constants
const EBAY_BROWSE_API = "https://api.ebay.com/buy/browse/v1/item_summary/search";
const EBAY_MAX_OFFSET = 10000; // eBay API limit
const EBAY_MAX_LIMIT = 100; // eBay API max per request
const DEFAULT_LIMIT = 20;

// Parts keywords to exclude from vehicle searches
// NOTE: These are checked as WORD BOUNDARIES (not substring match) to avoid false positives
// e.g., "for" would incorrectly match "Ford Focus for sale"
const PARTS_DENY_KEYWORDS = [
  // Sensors & small parts
  "tpms sensor", "valve stem", "valve cap", "hubcap", "hub cap",
  "wheel cover", "rim cover", "floor mat", "floor liner", "seat cover",
  "dash cover", "car cover", "mud flap", "splash guard",
  "emblem", "badge", "decal", "sticker", 
  // Mechanical parts
  "brake pad", "brake pads", "brake rotor", "brake caliper", "brake line",
  "oil filter", "air filter", "cabin filter", "fuel filter",
  "spark plug", "spark plugs", "ignition coil",
  "alternator part", "starter motor part",
  "thermostat", "water pump",
  "serpentine belt", "timing belt", "timing chain",
  "gasket", "gasket set", "o-ring", "bearing set", "bushing kit",
  "shock absorber", "strut assembly", "control arm",
  "ball joint", "tie rod end", "sway bar link", 
  "exhaust pipe", "muffler", "catalytic converter",
  "headlight bulb", "tail light bulb", "turn signal bulb",
  "fuse box", "relay module", "wiring harness",
  "key fob", "remote key", "transponder key",
  "repair manual", "service manual", "owner manual",
  "lug wrench", "torque wrench", "floor jack",
  // Accessories
  "phone mount", "cup holder insert", "cargo net", "trunk organizer",
  // Automotive shop equipment  
  "automotive lift", "car lift", "vehicle lift", "two post lift", "four post lift",
  "scissor lift", "alignment machine", "alignment rack", "wheel alignment",
  "tire changer", "tire machine", "wheel balancer", "balancing machine",
  "diagnostic scanner", "obd scanner", "obd2 scanner", "obdii scanner", "code reader", "scan tool",
  "diagnostic tool", "diagnostic computer", "engine analyzer",
  "brake lathe", "rotor lathe", "parts washer", "spray booth", "paint booth",
  "engine hoist", "engine crane", "transmission jack", "shop press", "hydraulic press",
  "a/c machine", "ac recharge", "refrigerant recovery", "fluid extractor",
  "mechanics creeper", "tool chest", "tool cabinet", "service cart",
  "sandblaster", "bead blaster", "media blaster", "engine stand",
  "dynamometer", "rotisserie", "battery tester", "load tester",
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

import { 
  SortOption, 
  CatalogFilters, 
  getEbaySort, 
  buildEbayFilters,
  postSortItems,
} from "./sortFilterNormalizer.ts";

export interface EbaySearchParams {
  query?: string;
  categoryId?: string;
  page?: number;
  pageSize?: number;
  minPrice?: number;
  maxPrice?: number;
  isVehicle?: boolean;
  isHeavyEquipment?: boolean;
  isParts?: boolean;
  marketplaceId?: string;
  sort?: SortOption;
  filters?: CatalogFilters;
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
  image_urls: string[]; // New: limited to 2 images (main + 1 additional)
  image_count: number;  // Total images available from listing
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
 * Upgrade eBay image URL to highest resolution (s-l1600)
 * eBay uses s-l### pattern where ### is the size (64, 140, 225, 300, 500, 1600)
 */
function upgradeEbayImageUrl(url: string | null): string | null {
  if (!url) return null;
  // Replace s-l### with s-l1600 for highest resolution
  return url.replace(/s-l\d+/g, "s-l1600");
}

/**
 * Count total images available from eBay listing (for image_count field)
 * This counts ALL images, not just the ones we return for list views
 */
function countTotalImages(item: Record<string, unknown>): number {
  let count = 0;
  
  // Primary image
  const image = item.image as Record<string, unknown> | undefined;
  if (image?.imageUrl) {
    count = 1;
  }
  
  // Additional images
  const additionalImages = item.additionalImages as Array<Record<string, unknown>> | undefined;
  if (additionalImages && Array.isArray(additionalImages)) {
    count += additionalImages.length;
  }
  
  // Fallback: if no main image, count thumbnails
  if (count === 0) {
    const thumbnailImages = item.thumbnailImages as Array<Record<string, unknown>> | undefined;
    if (thumbnailImages && Array.isArray(thumbnailImages)) {
      count = thumbnailImages.length;
    }
  }
  
  // Never return 0 if we have any image
  return count > 0 ? count : 1;
}

/**
 * Extract and normalize eBay images
 * For LIST views (default): limited to 2 images for performance
 * For VEHICLES: returns ALL images for full gallery display
 * 
 * @param item Raw eBay item data
 * @param options.isVehicle If true, returns all images (no limit)
 */
interface ExtractImagesOptions {
  isVehicle?: boolean;
}

function extractHighResImages(
  item: Record<string, unknown>, 
  options: ExtractImagesOptions = {}
): { mainImageUrl: string | null; imageUrls: string[]; imageCount: number } {
  const { isVehicle = false } = options;
  const seen = new Set<string>();
  const images: string[] = [];
  
  // Return full gallery for ALL items (removed 2-image limit)
  const maxImages = 100;

  // Primary image (highest priority)
  const image = item.image as Record<string, unknown> | undefined;
  if (image?.imageUrl) {
    const upgraded = upgradeEbayImageUrl(image.imageUrl as string);
    if (upgraded && !seen.has(upgraded)) {
      seen.add(upgraded);
      images.push(upgraded);
    }
  }

  // Additional images - get more for vehicles
  const additionalImages = item.additionalImages as Array<Record<string, unknown>> | undefined;
  if (additionalImages) {
    for (const img of additionalImages) {
      if (images.length >= maxImages) break;
      const upgraded = upgradeEbayImageUrl(img.imageUrl as string);
      if (upgraded && !seen.has(upgraded)) {
        seen.add(upgraded);
        images.push(upgraded);
      }
    }
  }

  // Fallback to thumbnails if no primary/additional (but still upgrade them)
  if (images.length === 0) {
    const thumbnailImages = item.thumbnailImages as Array<Record<string, unknown>> | undefined;
    if (thumbnailImages) {
      for (const img of thumbnailImages) {
        if (images.length >= maxImages) break;
        const upgraded = upgradeEbayImageUrl(img.imageUrl as string);
        if (upgraded && !seen.has(upgraded)) {
          seen.add(upgraded);
          images.push(upgraded);
        }
      }
    }
  }

  // Get total image count from the listing
  const imageCount = countTotalImages(item);

  return {
    mainImageUrl: images[0] || null,
    imageUrls: images, // All collected images (limited by maxImages)
    imageCount,
  };
}

import { getCachedEbayToken, invalidateEbayTokenCache } from "./settingsMemoryCache.ts";

/**
 * Get eBay OAuth token with caching
 * Uses in-memory cache to avoid fetching token on every request
 */
async function getEbayToken(): Promise<string | null> {
  return getCachedEbayToken();
}

/**
 * Invalidate eBay token cache (call on 401 errors)
 */
export function invalidateEbayToken(): void {
  invalidateEbayTokenCache();
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
 * Normalize eBay item to standard format with high-res images
 * @param item Raw eBay item data
 * @param categoryKey Category key for classification
 * @param options.isVehicle If true, includes all images for gallery display
 */
interface NormalizeOptions {
  isVehicle?: boolean;
}

function normalizeEbayItem(
  item: Record<string, unknown>, 
  categoryKey: string | null,
  options: NormalizeOptions = {}
): NormalizedItem {
  const { isVehicle = false } = options;
  
  const price = item.price as Record<string, unknown> | undefined;
  const priceValue = price?.value ? parseFloat(price.value as string) : null;
  const currency = (price?.currency as string) || "USD";

  // Use image extraction with vehicle flag for full galleries
  const { mainImageUrl, imageUrls, imageCount } = extractHighResImages(item, { isVehicle });

  const buyingOptions = (item.buyingOptions as string[]) || [];
  const itemWebUrl = item.itemWebUrl as string || "";
  const itemId = item.itemId as string || "";

  return {
    id: `ebay_${itemId}`,
    title: (item.title as string) || "",
    price_usd: currency === "USD" ? priceValue : priceValue, // TODO: convert other currencies
    currency,
    image_url: mainImageUrl,
    images: imageUrls, // All images (more for vehicles)
    image_urls: imageUrls, // All collected images
    image_count: imageCount, // Total images available from listing
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
 * Build eBay search URL with filters and sort
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
  
  // Sort - apply eBay-specific sort param
  const sortParam = params.sort ? getEbaySort(params.sort) : null;
  if (sortParam) {
    url.searchParams.set("sort", sortParam);
  }
  
  // Build filter string
  let filters: string[] = [];
  
  // Buy It Now only (FIXED_PRICE) - exclude auctions
  filters.push("buyingOptions:{FIXED_PRICE}");
  
  // Price filter from minPrice param (legacy support)
  if (params.minPrice !== undefined && params.minPrice > 0 && !params.filters?.minPrice) {
    filters.push(`price:[${params.minPrice}..],priceCurrency:USD`);
  }
  
  // US items preferred
  filters.push("itemLocationCountry:US");
  
  // Apply additional filters from CatalogFilters
  if (params.filters) {
    filters = buildEbayFilters(params.filters, filters);
  }
  
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
    
    // Handle rate limiting (429) with graceful degradation
    if (response.status === 429) {
      console.warn(`[EBAY_BROWSE] requestId=${requestId} RATE_LIMITED (429) - returning empty with warning`);
      return {
        items: [],
        total: 0,
        page,
        pageSize,
        hasMore: false,
        nextOffset: null,
        warning: { message: "eBay rate limit exceeded, please retry later", code: "RATE_LIMITED" },
      };
    }
    
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
    
    // Determine if this is a vehicle search (for full image galleries)
    const isVehicle = params.isVehicle && !params.isParts;
    const isHeavyEquipment = !!params.isHeavyEquipment;
    
    // Filter and normalize items with vehicle flag for full image galleries
    let items = rawItems.map(item => normalizeEbayItem(item, params.categoryId || null, { isVehicle }));
    
    // Apply vehicle-specific filtering — SKIP for heavy equipment (tractors, excavators, etc.)
    // Heavy equipment listings legitimately contain words like "engine", "transmission", "loader"
    if (isVehicle && !isHeavyEquipment) {
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
    } else if (isHeavyEquipment) {
      console.log(`[EBAY_BROWSE] requestId=${requestId} HEAVY_EQUIPMENT: skipping parts keyword filter (${items.length} items kept)`);
    }
    
    // Apply post-sort for sorts eBay doesn't support (e.g., rating)
    if (params.sort === 'rating') {
      items = postSortItems(items, 'rating') as NormalizedItem[];
      console.log(`[EBAY_BROWSE] requestId=${requestId} Applied post-sort: rating`);
    }
    
    // Calculate pagination
    const nextOffset = offset + pageSize;
    const hasMore = nextOffset < Math.min(total, EBAY_MAX_OFFSET) && items.length > 0;
    
    // Log vehicle image stats
    if (isVehicle && items.length > 0) {
      const avgImages = items.reduce((sum, i) => sum + i.image_urls.length, 0) / items.length;
      console.log(`[EBAY_BROWSE] requestId=${requestId} VEHICLE_IMAGES avgPerItem=${avgImages.toFixed(1)}`);
    }
    
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
