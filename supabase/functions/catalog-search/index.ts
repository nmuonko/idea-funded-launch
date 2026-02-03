/**
 * Catalog Search Endpoint - Provider Mixing (eBay + Amazon)
 * 
 * GET /catalog-search?q=iphone&cursor=...&limit=24&provider=mixed
 * 
 * Features:
 * - Mixed mode: Amazon-first, then blend, then eBay-only
 * - Budget control for Amazon API calls
 * - Caching with stale-while-revalidate
 * - Cursor-based infinite pagination
 * - French → English search query rewriting
 * 
 * ALWAYS returns HTTP 200 with stable JSON
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { getEnvironmentFromRequest, EnvironmentName } from "../_shared/environmentResolver.ts";
import { searchEbay, NormalizedItem } from "../_shared/ebayBrowseSearch.ts";
import { searchRainforest } from "../_shared/rainforestAdapter.ts";
import { isBlockedSearchQuery, getBlockedSearchMessage, filterDisallowedItems } from "../_shared/contentBlocker.ts";
import { mapCategoryAndSubcategory } from "../_shared/categoryMapper.ts";
import { isAllowedMotorListing } from "../_shared/motorsFilter.ts";
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
import { 
  buildCacheKey, 
  getCache, 
  setCache,
  CacheResult,
} from "../_shared/catalogCache.ts";
import { rewriteSearchQuery, SearchMeta } from "../_shared/searchRewriter.ts";
import { canonicalizeQuery } from "../_shared/queryCanonicalizer.ts";
import { enrichItemsWithMediaCounts } from "../_shared/mediaCache.ts";
import { 
  getAmazonLiveSettings, 
  shouldUseAmazonLive, 
  buildAmazonCacheKey,
  logMixerRequest,
  AmazonLiveDecision,
  AmazonLiveReason,
} from "../_shared/amazonLivePolicy.ts";
import {
  SortOption,
  CatalogFilters,
  validateSort,
  parseFilters,
  getDbSort,
  postFilterItems,
  postSortItems,
  buildAppliedSortFilter,
  AppliedSortFilter,
} from "../_shared/sortFilterNormalizer.ts";
import { getEnabledProviders, getClientPlatform, ClientPlatform } from "../_shared/featureFlags.ts";
import { getClientIp } from "../_shared/rateLimiter.ts";
import { 
  getProxyCacheSettings, 
  ProxyCacheSettings,
} from "../_shared/proxyCache.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-afrishop-environment, x-device-id",
  "Cache-Control": "public, max-age=60",
};

const VEHICLE_QUERY_KEYWORDS = [
  // Vehicle types
  "car", "cars", "truck", "trucks", "suv", "sedan", "coupe", "pickup", "van", "minivan",
  "hatchback", "convertible", "wagon", "crossover",
  // Popular car brands
  "toyota", "honda", "jeep", "bmw", "mercedes", "ford", "chevy", "chevrolet",
  "nissan", "kia", "hyundai", "lexus", "audi", "tesla", "mazda", "subaru",
  "volkswagen", "vw", "dodge", "ram", "gmc", "cadillac", "buick", "lincoln",
  "acura", "infiniti", "genesis", "porsche", "jaguar", "land rover", "range rover",
  "volvo", "mini", "fiat", "alfa romeo", "maserati", "ferrari", "lamborghini",
  "bentley", "rolls royce", "aston martin", "mclaren", "bugatti",
  // Specific popular models
  "camry", "corolla", "rav4", "highlander", "tacoma", "tundra", "4runner", "prius",
  "civic", "accord", "cr-v", "pilot", "odyssey", "hr-v",
  "f-150", "f150", "mustang", "explorer", "escape", "bronco", "ranger",
  "silverado", "tahoe", "suburban", "colorado", "equinox", "malibu", "camaro",
  "wrangler", "grand cherokee", "gladiator", "compass", "renegade",
  "model 3", "model s", "model x", "model y", "cybertruck",
  "3 series", "5 series", "x3", "x5", "m3", "m5",
  "c-class", "e-class", "s-class", "gle", "glc", "amg",
  "a4", "a6", "q5", "q7", "r8", "rs",
  "altima", "sentra", "rogue", "pathfinder", "frontier", "titan",
  "elantra", "sonata", "tucson", "santa fe", "palisade",
  "forte", "optima", "k5", "sportage", "telluride", "sorento",
  // Motorcycles
  "motorcycle", "harley", "yamaha", "kawasaki", "ducati", "suzuki", "triumph", "indian",
  "sportster", "softail", "road king", "street glide",
  // Other vehicles
  "boat", "pontoon", "yacht", "rv", "camper", "trailer", "motorhome",
  "atv", "utv", "quad", "polaris", "can-am", "side by side", "rzr",
  // French vehicle terms + English generic
  "voiture", "voitures", "moto", "camion", "vehicule", "vehicle", "vehicles", "automobile",
];

// Keywords that indicate user wants to BUY a vehicle (not parts/accessories)
const VEHICLE_BUYING_INTENT_KEYWORDS = [
  "for sale", "à vendre", "buy", "acheter", "purchase",
  "used car", "new car", "certified pre-owned", "cpo",
  "dealer", "dealership", "financing", "lease",
  "used", "pre-owned", "preowned",
];

// Keywords that indicate user wants vehicle accessories/parts (NOT the vehicle itself)
const VEHICLE_ACCESSORY_KEYWORDS = [
  "floor mat", "floor mats", "mat", "mats", "cover", "covers", "case",
  "filter", "oil filter", "air filter", "cabin filter",
  "brake", "brakes", "brake pad", "brake pads",
  "part", "parts", "accessory", "accessories",
  "key fob", "key", "remote", "fob",
  "battery", "batteries",
  "tire", "tires", "wheel", "wheels", "rim", "rims",
  "seat cover", "seat covers", "cargo", "liner", "liners",
  "sunshade", "visor", "windshield",
  "headlight", "taillight", "bulb", "led",
  "mirror", "antenna", "wiper", "wipers",
  "charger", "adapter", "mount", "holder",
  "emblem", "badge", "decal", "sticker",
  "radio", "stereo", "speaker", "amplifier", "subwoofer",
  "gps", "dash cam", "camera", "sensor",
  "floor", "carpet", "trunk", "cargo net",
  "phone", "tablet", "iphone", "samsung", "android",
];

// Specific vehicle models that indicate vehicle search intent (brand + model = vehicle mode)
// These are FULL VEHICLE MODELS (not shared with other products)
const VEHICLE_MODEL_PATTERNS: Array<{ brand: string; models: string[] }> = [
  { brand: "infiniti", models: ["qx80", "qx60", "qx55", "qx50", "q50", "q60", "q70", "fx35", "fx45", "g35", "g37", "m35", "m37", "m45", "m56"] },
  { brand: "lexus", models: ["rx350", "rx450", "es350", "es300", "ls460", "ls500", "gx460", "gx470", "lx570", "lx600", "nx350", "ux250", "is350", "is300", "is250", "gs350", "gs300", "rc350"] },
  { brand: "acura", models: ["mdx", "rdx", "tlx", "ilx", "nsx", "integra", "rlx", "zdx"] },
  { brand: "bmw", models: ["x5", "x3", "x7", "x1", "x6", "m3", "m5", "m4", "330i", "530i", "540i", "750i", "840i"] },
  { brand: "mercedes", models: ["gle", "glc", "gls", "amg", "c300", "e350", "s550", "g550", "g63", "cla", "cls"] },
  { brand: "audi", models: ["q5", "q7", "q8", "a4", "a6", "a8", "s4", "s5", "rs7", "rs6", "tt", "r8", "e-tron", "etron"] },
  { brand: "porsche", models: ["cayenne", "macan", "panamera", "taycan", "911", "718", "cayman", "boxster"] },
  { brand: "toyota", models: ["camry", "corolla", "rav4", "highlander", "tacoma", "tundra", "4runner", "prius", "sienna", "venza", "sequoia", "supra", "gr86", "land cruiser", "landcruiser"] },
  { brand: "honda", models: ["civic", "accord", "cr-v", "crv", "pilot", "odyssey", "hr-v", "hrv", "ridgeline", "passport", "fit", "insight"] },
  { brand: "ford", models: ["f-150", "f150", "f-250", "f250", "mustang", "explorer", "escape", "bronco", "ranger", "expedition", "edge", "maverick", "raptor"] },
  { brand: "chevrolet", models: ["silverado", "tahoe", "suburban", "colorado", "equinox", "malibu", "camaro", "corvette", "traverse", "blazer", "trax", "bolt"] },
  { brand: "chevy", models: ["silverado", "tahoe", "suburban", "colorado", "equinox", "malibu", "camaro", "corvette", "traverse", "blazer", "trax", "bolt"] },
  { brand: "jeep", models: ["wrangler", "grand cherokee", "cherokee", "gladiator", "compass", "renegade", "wagoneer", "grand wagoneer"] },
  { brand: "tesla", models: ["model 3", "model s", "model x", "model y", "cybertruck"] },
  { brand: "nissan", models: ["altima", "sentra", "rogue", "pathfinder", "frontier", "titan", "maxima", "murano", "armada", "kicks", "leaf", "z", "370z", "350z"] },
  { brand: "hyundai", models: ["elantra", "sonata", "tucson", "santa fe", "palisade", "kona", "ioniq", "venue", "genesis"] },
  { brand: "kia", models: ["forte", "optima", "k5", "sportage", "telluride", "sorento", "seltos", "carnival", "niro", "ev6", "stinger"] },
  { brand: "dodge", models: ["charger", "challenger", "durango", "ram", "journey", "hornet"] },
  { brand: "ram", models: ["1500", "2500", "3500", "promaster"] },
  { brand: "gmc", models: ["sierra", "yukon", "acadia", "terrain", "canyon", "denali", "hummer"] },
  { brand: "subaru", models: ["outback", "forester", "crosstrek", "impreza", "wrx", "brz", "ascent", "legacy"] },
  { brand: "mazda", models: ["cx-5", "cx5", "cx-9", "cx9", "cx-30", "cx30", "mazda3", "mazda6", "mx-5", "miata"] },
  { brand: "volkswagen", models: ["jetta", "passat", "tiguan", "atlas", "golf", "gti", "id.4", "id4", "taos", "arteon"] },
  { brand: "vw", models: ["jetta", "passat", "tiguan", "atlas", "golf", "gti", "id.4", "id4", "taos", "arteon"] },
  { brand: "volvo", models: ["xc90", "xc60", "xc40", "s60", "s90", "v60", "v90"] },
  { brand: "cadillac", models: ["escalade", "xt5", "xt6", "ct5", "ct4", "lyriq"] },
  { brand: "lincoln", models: ["navigator", "aviator", "corsair", "nautilus"] },
  { brand: "genesis", models: ["g80", "g70", "g90", "gv80", "gv70", "gv60"] },
  { brand: "jaguar", models: ["f-pace", "e-pace", "i-pace", "xe", "xf", "xj", "f-type"] },
  { brand: "land rover", models: ["range rover", "discovery", "defender", "evoque", "velar"] },
  { brand: "range rover", models: ["sport", "velar", "evoque", "autobiography"] },
];

/**
 * Check if a query contains a known vehicle make+model combination
 * This indicates strong vehicle intent (e.g., "infiniti qx80" = actual vehicle search)
 * 
 * IMPORTANT: This function uses strict matching - both brand AND model must be present
 * Examples:
 *   "infiniti qx80" → true (brand + model)
 *   "infiniti" → false (brand only)
 *   "qx80" → false (model only)
 *   "infiniti qx80 floor mats" → true (but hasVehicleBuyingIntent will return false due to accessory keyword)
 */
function isVehicleMakeModelQuery(query: string): boolean {
  const lower = query.toLowerCase().trim();
  
  for (const { brand, models } of VEHICLE_MODEL_PATTERNS) {
    // Check if brand is present as a word boundary (not just substring)
    // This prevents false positives like "infinitix" matching "infiniti"
    const brandRegex = new RegExp(`\\b${brand}\\b`, 'i');
    if (brandRegex.test(lower)) {
      for (const model of models) {
        // Check if model is present (models can be substrings like "qx80")
        if (lower.includes(model)) {
          console.log(`[VEHICLE_DETECT] Make+Model detected: brand="${brand}" model="${model}" in query="${query}"`);
          return true;
        }
      }
    }
  }
  return false;
}

/**
 * Check if a query indicates explicit vehicle-BUYING intent
 * (as opposed to wanting accessories/parts for a vehicle)
 * 
 * VEHICLE MODE LOGIC:
 * 1. If query has accessory keywords (floor mats, key fob, etc.) → NOT vehicle buying intent
 * 2. If query has explicit buying keywords (for sale, buy, etc.) → vehicle buying intent
 * 3. If query has make+model (infiniti qx80, toyota camry) → vehicle buying intent
 * 4. Brand-only queries (just "infiniti") → NOT vehicle buying intent (allow accessories)
 * 
 * When vehicleMode=true:
 * - Enforce minPrice >= $1000 to filter out accessories
 * - Force eBay to Motors category 6001
 * - Use Amazon Autos category for Amazon
 */
function hasVehicleBuyingIntent(query: string): boolean {
  const lower = query.toLowerCase().trim();
  
  // FIRST: Check for accessory/parts keywords - these override everything
  // If user searches "infiniti qx80 floor mats", they want floor mats, not a vehicle
  const hasAccessoryKeywords = VEHICLE_ACCESSORY_KEYWORDS.some(kw => lower.includes(kw));
  if (hasAccessoryKeywords) {
    console.log(`[VEHICLE_DETECT] Accessory keywords found in "${query}" - NOT vehicle buying intent`);
    return false;
  }
  
  // SECOND: Check for explicit buying intent keywords
  const hasExplicitBuyingIntent = VEHICLE_BUYING_INTENT_KEYWORDS.some(kw => lower.includes(kw));
  if (hasExplicitBuyingIntent) {
    console.log(`[VEHICLE_DETECT] Explicit buying intent in "${query}" - IS vehicle buying intent`);
    return true;
  }
  
  // THIRD: Check for make+model combinations (e.g., "infiniti qx80")
  // These strongly indicate the user wants to find a vehicle, not accessories
  if (isVehicleMakeModelQuery(query)) {
    console.log(`[VEHICLE_DETECT] Make+Model detected in "${query}" - IS vehicle buying intent`);
    return true;
  }
  
  // For brand-only queries (e.g., just "infiniti"), don't assume vehicle intent
  // User might be looking for accessories or general products
  return false;
}

const DEFAULT_LIMIT = 36;
const MAX_LIMIT = 100;

// ─── TYPES ────────────────────────────────────────────────────────────────────

interface CatalogItem extends ProviderItem {
  id: string;
  provider: string;
  providerProductId: string;
  title: string | null;
  priceUsd: number | null;
  currency: string;
  mainImageUrl: string | null;   // Single best image for list performance
  imageUrl: string | null;       // Backward compat
  images: string[];              // Full image gallery
  imageUrls: string[];           // Full image gallery (alias)
  imageCount: number;            // Total images available from listing
  productUrl: string | null;
  inStock: boolean | null;
  rating: number | null;
  category?: string;
  subcategory?: string;
  condition?: string;
  shippingPrice?: number | null;
  location?: string | null;
}

interface MediaEnrichmentStats {
  checked: number;
  cacheHit: number;
  fetched: number;
  timedOut: number;
}

interface SearchResponse {
  status: "success" | "error";
  env: string;
  query: string;
  items: CatalogItem[];
  nextCursor: string | null;
  hasMore: boolean;
  total: number;
  facets?: unknown[];
  appliedFilters?: AppliedSortFilter;
  providerStats: ProviderStats & {
    amazonLiveUsed?: boolean;
    amazonLiveReason?: AmazonLiveReason;
  };
  searchMeta?: SearchMeta;  // Query rewrite metadata
  mediaStats?: MediaEnrichmentStats;  // Media cache enrichment stats (dev only)
  durationMs: number;
  warning?: { message: string; code: string };
  error: { code: string; message: string } | null;
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function isVehicleQuery(query: string): boolean {
  const lower = query.toLowerCase();
  return VEHICLE_QUERY_KEYWORDS.some(kw => lower.includes(kw));
}

function generateRequestId(): string {
  return crypto.randomUUID().slice(0, 8);
}

/**
 * Upgrade eBay image URL to highest resolution (s-l1600)
 * eBay uses s-l### pattern where ### is the size (64, 140, 225, 300, 500, 1600)
 */
function upgradeEbayImage(url: string | null): string | null {
  if (!url) return null;
  const wasThumbnail = /s-l(64|96|140|200|225|300|400|500)\b/i.test(url);
  const upgraded = url.replace(/s-l\d+/gi, "s-l1600");
  if (wasThumbnail) {
    console.log("[EBAY_IMAGE_UPGRADE]", JSON.stringify({
      original: url.substring(0, 60),
      upgraded: upgraded.substring(0, 60),
    }));
  }
  return upgraded;
}

/**
 * Upgrade Amazon image URL to highest resolution
 * Amazon uses various size tokens: _SX###, _SY###, _AC_US###, etc.
 */
function upgradeAmazonImage(url: string | null): string | null {
  if (!url) return null;
  
  // Already high-res
  if (url.includes("_SL1500") || url.includes("_SL1600")) return url;
  
  // Detect thumbnail patterns
  const THUMBNAIL_PATTERNS = [
    /_SS\d{2,3}\./i,
    /_SX\d{2,3}\./i,
    /_SY\d{2,3}\./i,
    /_AC_U[SY]\d{2,3}/i,
    /_SR\d+,\d+\./i,
  ];
  
  const wasThumbnail = THUMBNAIL_PATTERNS.some(p => p.test(url));
  
  // Upgrade size tokens
  let upgraded = url
    .replace(/_S[XYL]\d{2,3}\./gi, "_SL1500.")
    .replace(/_SS\d{2,3}\./gi, "_SL1500.")
    .replace(/_AC_U[SYL]\d{2,3}/gi, "_AC_SL1500")
    .replace(/_SR\d+,\d+\./gi, "_SL1500.");
  
  if (wasThumbnail) {
    console.log("[AMAZON_IMAGE_UPGRADE]", JSON.stringify({
      original: url.substring(0, 60),
      upgraded: upgraded.substring(0, 60),
    }));
  }
  
  return upgraded;
}

function mapEbayItemToResponse(item: NormalizedItem): CatalogItem {
  const metadata = item.metadata || {};
  // Upgrade eBay images to high-res
  const rawMainImage = item.image_url || (item.image_urls?.length > 0 ? item.image_urls[0] : null);
  const mainImage = upgradeEbayImage(rawMainImage);
  const imagesArray = item.images || item.image_urls || [];
  
  return {
    id: item.id,
    provider: "ebay",
    providerProductId: item.provider_product_id,
    title: item.title,
    priceUsd: item.price_usd,
    currency: item.currency,
    mainImageUrl: mainImage,
    imageUrl: mainImage,  // Backward compat
    images: imagesArray,
    imageUrls: imagesArray,
    imageCount: item.image_count || imagesArray.length || 1,
    productUrl: item.product_url,
    inStock: item.in_stock,
    rating: item.rating,
    condition: (metadata.condition as string) || undefined,
    shippingPrice: (metadata.shipping_price as number) || null,
    location: (metadata.location as string) || null,
  };
}

function mapDbItemToResponse(item: Record<string, unknown>): CatalogItem {
  const provider = (item.provider as string) || "amazon";
  
  // For list views, only return single main image
  let rawImageUrl = item.image_url as string | null;
  
  // Get full images array
  const imagesArray = Array.isArray(item.images) ? item.images as string[] : [];
  if (!rawImageUrl && imagesArray.length > 0) {
    rawImageUrl = imagesArray[0] as string;
  }
  
  // Upgrade to high-res based on provider
  let mainImage: string | null = rawImageUrl;
  if (rawImageUrl) {
    if (provider === "rainforest" || provider === "amazon") {
      mainImage = upgradeAmazonImage(rawImageUrl);
    } else if (provider === "ebay") {
      mainImage = upgradeEbayImage(rawImageUrl);
    }
  }
  
  // Compute image count from stored images array or default to 1
  const imageCount = imagesArray.length > 0 ? imagesArray.length : 1;
  
  return {
    id: item.id as string,
    provider,
    providerProductId: item.provider_product_id as string,
    title: item.title as string | null,
    priceUsd: item.price_usd as number | null,
    currency: "USD",
    mainImageUrl: mainImage,
    imageUrl: mainImage,  // Backward compat
    images: imagesArray,
    imageUrls: imagesArray,
    imageCount,           // Total images available
    productUrl: item.product_url as string | null,
    inStock: item.in_stock as boolean | null,
    rating: item.rating as number | null,
    category: item.unified_category as string | undefined,
    subcategory: item.unified_subcategory as string | undefined,
  };
}

// ─── AMAZON FETCH HELPER ──────────────────────────────────────────────────────

// deno-lint-ignore no-explicit-any
type SupabaseClientAny = ReturnType<typeof createClient<any, any>>;

interface AmazonFetchParams {
  supabase: SupabaseClientAny;
  query: string;
  settings: CatalogSettings;
  effectiveMode: { amazonActive: boolean; mode: string };
  mixerCursor: MixerCursor;
  isVehicle: boolean;
  hasBuyingIntent: boolean;  // NEW: Pass buying intent for minPrice enforcement
  categoryKey: string | undefined;
  limit: number;
  catalogFilters: CatalogFilters;  // NEW: Pass filters for minPrice/maxPrice
  requestId: string;
}

interface AmazonFetchResult {
  items: CatalogItem[];
  hasMore: boolean;
  cacheHit: boolean;
  budgetRemaining: number | null;
  status: AmazonStatusInfo["status"];
  liveUsed: boolean;
  liveReason: AmazonLiveReason;
}

async function fetchAmazonItems(params: AmazonFetchParams): Promise<AmazonFetchResult> {
  const { supabase, query, settings, effectiveMode, mixerCursor, isVehicle, hasBuyingIntent, categoryKey, limit, catalogFilters, requestId } = params;
  
  const AMAZON_AUTOS_CATEGORY_ID = "10677469011";
  
  let items: CatalogItem[] = [];
  let hasMore = false;
  let cacheHit = false;
  let budgetRemaining: number | null = null;
  let status: AmazonStatusInfo["status"] = "disabled";
  let liveUsed = false;
  let liveReason: AmazonLiveReason = "disabled";

  if (!effectiveMode.amazonActive || effectiveMode.mode === "ebay") {
    return { items, hasMore, cacheHit, budgetRemaining, status, liveUsed, liveReason };
  }

  try {
    // Check budget
    const budgetStatus = await checkBudget(
      supabase,
      "amazon",
      settings.amazonBudgetWindow,
      settings.amazonMaxCallsPerHour,
      requestId
    );
    budgetRemaining = budgetStatus.remaining;

    // Load live settings
    const liveSettings = await getAmazonLiveSettings(supabase);

    // Check if cap hit for this query
    const queryCapHit = mixerCursor.amazonReturnedSoFar >= settings.amazonMaxResultsPerQuery;

    if (queryCapHit) {
      status = "cap_exhausted";
      liveReason = "cache_only";
      console.log(`[SEARCH] requestId=${requestId} Amazon cap exhausted: ${mixerCursor.amazonReturnedSoFar}/${settings.amazonMaxResultsPerQuery}`);
    } else {
      // Determine if we should use live API
      const liveDecision = shouldUseAmazonLive({
        endpoint: "search",
        query,
        amazonPage: mixerCursor.amazonPage,
        amazonEnabled: effectiveMode.amazonActive,
        budgetAllowed: budgetStatus.allowed,
        budgetRemaining: budgetStatus.remaining,
        liveSettings,
        requestId,
      });

      liveReason = liveDecision.reason;

      if (liveDecision.useLive) {
        // ─── LIVE RAINFOREST API ─────────────────────────────────────────
        const vehicleCategoryId = isVehicle ? AMAZON_AUTOS_CATEGORY_ID : undefined;
        
        // CRITICAL: Pass minPrice filter to Rainforest for vehicle searches
        const minPriceFilter = hasBuyingIntent && catalogFilters.minPrice ? catalogFilters.minPrice : undefined;
        console.log(`[SEARCH] requestId=${requestId} Amazon LIVE search: "${query}" page=${mixerCursor.amazonPage}${vehicleCategoryId ? ` category=${vehicleCategoryId}` : ""}${minPriceFilter ? ` minPrice=${minPriceFilter}` : ""}`);
        
        const liveResult = await searchRainforest(query, mixerCursor.amazonPage, limit, "amazon.com", "relevance", { minPrice: minPriceFilter }, vehicleCategoryId);
        
        if (!liveResult.error && liveResult.products.length > 0) {
          liveUsed = true;
          status = "live";

          // Increment budget after successful call
          await incrementBudget(supabase, "amazon", settings.amazonBudgetWindow, requestId);
          budgetRemaining = Math.max(0, (budgetRemaining || 0) - 1);

          // Map live products to CatalogItem format
          items = liveResult.products.map(p => ({
            id: `amazon_${p.providerProductId}`,
            provider: "rainforest",
            providerProductId: p.providerProductId,
            title: p.title,
            priceUsd: p.priceUsd,
            currency: "USD",
            mainImageUrl: upgradeAmazonImage(p.imageUrl),
            imageUrl: upgradeAmazonImage(p.imageUrl),
            images: (p.images && Array.isArray(p.images) && p.images.length > 0) ? p.images : (p.imageUrl ? [p.imageUrl] : []),
            imageUrls: (p.images && Array.isArray(p.images) && p.images.length > 0) ? p.images : (p.imageUrl ? [p.imageUrl] : []),
            imageCount: (p.imageCount as number) || ((p.images as string[])?.length || 1),
            productUrl: p.productUrl,
            inStock: p.inStock ?? true,
            rating: p.rating,
            category: categoryKey || undefined,
          }));
          hasMore = liveResult.hasMore;

          // Cache the live results (async, don't wait)
          const cacheKey = buildAmazonCacheKey({ query, categoryKey, page: mixerCursor.amazonPage });
          const now = new Date();
          const cacheTtlSeconds = settings.searchCacheTtlSeconds || 172800;
          const expiresAt = new Date(now.getTime() + cacheTtlSeconds * 1000);
          const staleAt = new Date(now.getTime() + (cacheTtlSeconds / 2) * 1000);

          supabase.from("catalog_cache").upsert({
            cache_key: cacheKey,
            cache_type: "search_amazon",
            provider: "rainforest",
            query,
            category: categoryKey,
            page: mixerCursor.amazonPage,
            response: { products: liveResult.products, total: liveResult.total, hasMore: liveResult.hasMore },
            expires_at: expiresAt.toISOString(),
            stale_at: staleAt.toISOString(),
            updated_at: now.toISOString(),
          }, { onConflict: "cache_key" });

          // Upsert into catalog_items (async, don't wait)
          const toUpsert = liveResult.products.map(p => {
            const { category: mappedCat, subcategory } = mapCategoryAndSubcategory({
              title: p.title || "",
              provider: "rainforest",
              productUrl: p.productUrl || "",
            });
            return {
              id: `amazon_${p.providerProductId}`,
              provider: "rainforest",
              provider_product_id: p.providerProductId,
              title: p.title,
              price_usd: p.priceUsd,
              image_url: p.imageUrl,
              images: (p.images && Array.isArray(p.images) && p.images.length > 0) ? p.images : (p.imageUrl ? [p.imageUrl] : []),
              product_url: p.productUrl,
              in_stock: p.inStock ?? true,
              rating: p.rating,
              unified_category: mappedCat !== "blocked" ? mappedCat : (categoryKey?.split("_")[0] || "electronics"),
              unified_subcategory: subcategory,
              updated_at: now.toISOString(),
            };
          });

          supabase.from("catalog_items").upsert(toUpsert, { onConflict: "id" });

          console.log(`[SEARCH] requestId=${requestId} Amazon LIVE returned ${items.length} items`);
        }
      }

      // If no live results or live not used, fall back to cache/DB
      if (items.length === 0) {
        // Try cache first
        const cacheKey = buildAmazonCacheKey({ query, categoryKey, page: mixerCursor.amazonPage });
        const { data: cachedData } = await supabase
          .from("catalog_cache")
          .select("response, expires_at")
          .eq("cache_key", cacheKey)
          .gt("expires_at", new Date().toISOString())
          .single();

        if (cachedData?.response) {
          const cached = cachedData.response as { products: Array<Record<string, unknown>>; hasMore: boolean };
          items = cached.products.map(p => ({
            id: `amazon_${p.providerProductId}`,
            provider: "rainforest",
            providerProductId: p.providerProductId as string,
            title: p.title as string | null,
            priceUsd: p.priceUsd as number | null,
            currency: "USD",
            mainImageUrl: upgradeAmazonImage(p.imageUrl as string | null),
            imageUrl: upgradeAmazonImage(p.imageUrl as string | null),
            images: (p.images && Array.isArray(p.images) && (p.images as string[]).length > 0) ? p.images as string[] : (p.imageUrl ? [p.imageUrl as string] : []),
            imageUrls: (p.images && Array.isArray(p.images) && (p.images as string[]).length > 0) ? p.images as string[] : (p.imageUrl ? [p.imageUrl as string] : []),
            imageCount: (p.imageCount as number) || ((p.images as string[])?.length || 1),
            productUrl: p.productUrl as string | null,
            inStock: (p.inStock as boolean | null) ?? true,
            rating: p.rating as number | null,
            category: categoryKey || undefined,
          }));
          hasMore = cached.hasMore;
          cacheHit = true;
          status = "cached";
          console.log(`[SEARCH] requestId=${requestId} Amazon CACHE hit: ${items.length} items`);
        } else {
          // Fall back to DB search
          // CRITICAL: For vehicle searches, don't search for parts/accessories
          const dbSearchQuery = isVehicle && hasBuyingIntent ? query : (isVehicle ? `${query}|automotive|car parts|auto` : query);
          const minPriceForDb = hasBuyingIntent && catalogFilters.minPrice ? catalogFilters.minPrice : undefined;
          console.log(`[SEARCH] requestId=${requestId} Amazon DB search: "${dbSearchQuery}" category_key=${categoryKey} minPrice=${minPriceForDb}`);

          let amazonQuery = supabase
            .from("catalog_items")
            .select("*", { count: "exact" })
            .or("provider.eq.rainforest,provider.eq.amazon")
            .or(`title.ilike.%${query}%,search_text.ilike.%${query}%${isVehicle && !hasBuyingIntent ? ',unified_category.eq.automotive,title.ilike.%car%,title.ilike.%auto%' : ''}`);

          // CRITICAL: Apply minPrice filter for vehicle buying intent
          if (minPriceForDb) {
            amazonQuery = amazonQuery.gte("price_usd", minPriceForDb);
          }

          if (categoryKey) {
            const parentCategory = categoryKey.split("_")[0];
            amazonQuery = amazonQuery.or(`unified_category.eq.${parentCategory},unified_category.is.null,unified_category.eq.uncategorized`);
          }

          const { data: amazonData, count } = await amazonQuery
            .order("rating", { ascending: false, nullsFirst: false })
            .range(
              mixerCursor.amazonReturnedSoFar,
              mixerCursor.amazonReturnedSoFar + limit - 1
            );

          if (amazonData && amazonData.length > 0) {
            items = amazonData.map(item => {
              const mapped = mapDbItemToResponse(item as Record<string, unknown>);
              if (categoryKey) {
                mapped.category = categoryKey;
              }
              return mapped;
            });
            hasMore = (count || 0) > mixerCursor.amazonReturnedSoFar + amazonData.length;
            cacheHit = true;
            status = "cached";
            console.log(`[SEARCH] requestId=${requestId} Amazon DB returned ${items.length} items (minPrice filter=${minPriceForDb})`);
          }
        }
      }
    }
  } catch (err) {
    console.error(`[SEARCH] requestId=${requestId} Amazon error:`, err);
    status = "error";
  }

  return { items, hasMore, cacheHit, budgetRemaining, status, liveUsed, liveReason };
}

// ─── EBAY FETCH HELPER ────────────────────────────────────────────────────────

interface EbayFetchParams {
  supabase: SupabaseClientAny;
  query: string;
  effectiveMode: { ebayActive: boolean; mode: string };
  isVehicle: boolean;
  hasBuyingIntent: boolean;  // Smart intent: true only when user explicitly wants to BUY a vehicle
  categoryKey: string | undefined;
  page: number;
  limit: number;
  catalogFilters: CatalogFilters;
  requestId: string;
}

interface EbayFetchResult {
  items: CatalogItem[];
  hasMore: boolean;
  total: number;
}

async function fetchEbayItems(params: EbayFetchParams): Promise<EbayFetchResult> {
  const { supabase, query, effectiveMode, isVehicle, hasBuyingIntent, categoryKey, page, limit, catalogFilters, requestId } = params;

  let items: CatalogItem[] = [];
  let hasMore = false;
  let total = 0;

  if (!effectiveMode.ebayActive || effectiveMode.mode === "amazon") {
    return { items, hasMore, total };
  }

  try {
    // VEHICLE MODE LOGIC: Enforce minPrice ONLY when user has buying intent
    // hasBuyingIntent = true for:
    //   - "infiniti qx80" (make+model detected)
    //   - "toyota camry for sale" (explicit buying keywords)
    // hasBuyingIntent = false for:
    //   - "infiniti qx80 floor mats" (accessory keyword detected)
    //   - "infiniti" (brand only, no model)
    const minPrice = hasBuyingIntent ? 1000 : undefined;
    console.log(`[SEARCH] requestId=${requestId} eBay minPrice=${minPrice} (hasBuyingIntent=${hasBuyingIntent})`);
    
    // Map category_key to eBay category ID if applicable
    let ebayCategory: string | undefined;
    if (categoryKey) {
      const categoryMapping: Record<string, string> = {
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
      ebayCategory = categoryMapping[categoryKey];
    }

    // Only force eBay Motors category when user explicitly wants to BUY a vehicle
    // For brand-only queries, let eBay search all categories to find accessories
    let enhancedQuery = query;
    if (hasBuyingIntent && !ebayCategory) {
      ebayCategory = "6001"; // Cars & Trucks category
      console.log(`[SEARCH] requestId=${requestId} Vehicle BUYING intent detected, forcing category=6001 for query="${query}"`);
    } else if (isVehicle && !hasBuyingIntent) {
      console.log(`[SEARCH] requestId=${requestId} Vehicle brand detected but no buying intent - searching all eBay categories for accessories`);
    }

    console.log(`[SEARCH] requestId=${requestId} eBay LIVE: q="${enhancedQuery}" isVehicle=${isVehicle} hasBuyingIntent=${hasBuyingIntent} minPrice=${minPrice} ebayCategory=${ebayCategory}`);

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

      console.log(`[SEARCH] requestId=${requestId} eBay returned ${items.length} items, total=${total}`);

      // Upsert to DB (async, don't wait)
      const toUpsert = filteredItems.map(item => {
        const { category, subcategory } = mapCategoryAndSubcategory({
          title: item.title,
          provider: "ebay",
          productUrl: item.product_url,
        });

        return {
          id: item.id,
          provider: "ebay",
          provider_product_id: item.provider_product_id,
          title: item.title,
          price_usd: item.price_usd,
          image_url: item.image_url,
          images: item.images,
          product_url: item.product_url,
          in_stock: item.in_stock,
          rating: item.rating,
          unified_category: category !== "blocked" ? category : "electronics",
          unified_subcategory: subcategory,
          updated_at: new Date().toISOString(),
        };
      });

      supabase.from("catalog_items").upsert(toUpsert, { onConflict: "id" });
    }
  } catch (err) {
    console.error(`[SEARCH] requestId=${requestId} eBay error:`, err);
  }

  return { items, hasMore, total };
}

// ─── MAIN HANDLER ─────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const requestId = generateRequestId();
  const startTime = Date.now();
  const url = new URL(req.url);

  const rawQuery = url.searchParams.get("q") || "";
  const qOriginal = rawQuery.trim();
  const cursor = url.searchParams.get("cursor") || null;
  const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(url.searchParams.get("limit") || String(DEFAULT_LIMIT), 10)));
  const providerParam = url.searchParams.get("provider") || null;
  const categoryKey = url.searchParams.get("category_key") || url.searchParams.get("category") || null;
  const lang = url.searchParams.get("lang") || "fr";
  const envName = getEnvironmentFromRequest(req);
  
  // Parse sort and filters
  const sortParam = url.searchParams.get("sort") || "relevance";
  const sort = validateSort(sortParam);
  const filtersParam = url.searchParams.get("filters") || null;
  const catalogFilters = parseFilters(filtersParam);

  // ─── EARLY VEHICLE DETECTION & PRICE FILTER OVERRIDE ────────────────────────
  // CRITICAL FIX: Canonicalize query FIRST so vehicle detection works on corrected typos
  // e.g., "inifiniti qx80" → "infiniti qx80" BEFORE checking for vehicle intent
  const qCanonicalized = canonicalizeQuery(qOriginal);
  const qNormEarly = qCanonicalized.toLowerCase().replace(/\s+/g, " ");
  const isVehicleEarly = isVehicleQuery(qNormEarly);
  
  // Log canonicalization if it changed the query
  if (qCanonicalized !== qOriginal) {
    console.log(`[CATALOG_SEARCH] requestId=${requestId} query_canonicalized: "${qOriginal}" → "${qCanonicalized}"`);
  }
  
  // VEHICLE SEARCH FIX: Override restrictive price filters for vehicle searches
  // Mobile apps may send default maxPrice filters (e.g., $1650) that are too low for vehicles
  // Real vehicles typically cost $3,000 - $100,000+, so a maxPrice < $5,000 would exclude most/all results
  const VEHICLE_REASONABLE_MIN_MAX_PRICE = 5000;
  
  if (isVehicleEarly && catalogFilters.maxPrice !== undefined) {
    if (catalogFilters.maxPrice < VEHICLE_REASONABLE_MIN_MAX_PRICE) {
      console.log(`[SEARCH] requestId=${requestId} Vehicle search: removing restrictive maxPrice=${catalogFilters.maxPrice} (vehicles typically cost $5,000+)`);
      delete catalogFilters.maxPrice;
    }
  }
  
  // SMART VEHICLE INTENT: Enforce minPrice when user wants to BUY a vehicle
  // Use CANONICALIZED query so typos like "inifiniti" still match "infiniti" brand
  const hasBuyingIntent = hasVehicleBuyingIntent(qCanonicalized);
  const hasMakeModel = isVehicleMakeModelQuery(qCanonicalized);
  
  if (hasBuyingIntent) {
    // Enforce minPrice of $1000 for vehicle searches (lower than $1500 to capture more listings)
    if (catalogFilters.minPrice === undefined || catalogFilters.minPrice < 1000) {
      catalogFilters.minPrice = 1000;
    }
    console.log(`[SEARCH] requestId=${requestId} Vehicle MODE ACTIVE: hasBuyingIntent=${hasBuyingIntent} hasMakeModel=${hasMakeModel} enforcing minPrice=${catalogFilters.minPrice} (canonicalized="${qCanonicalized}")`);
  } else if (isVehicleEarly) {
    console.log(`[SEARCH] requestId=${requestId} Vehicle brand detected but no buying intent - allowing all prices for accessories`);
  }

  // Initialize search metadata (will be populated by rewriter)
  let searchMeta: SearchMeta = {
    originalQuery: qOriginal,
    normalizedQuery: qNormEarly,
    rewrittenQuery: qNormEarly,
    rewriteApplied: false,
    ruleId: null,
    rulePriority: null,
    categoryKey,
  };

  console.log(`[CATALOG_SEARCH] requestId=${requestId} request`, JSON.stringify({ q: qOriginal, category_key: categoryKey, cursor, limit, provider: providerParam, lang, isVehicle: isVehicleEarly, hasBuyingIntent, hasMakeModel }));

  // Build empty response helper
  const buildEmptyResponse = (error?: { code: string; message: string }): SearchResponse => ({
    status: error ? "error" : "success",
    env: envName,
    query: qOriginal,
    items: [],
    nextCursor: null,
    hasMore: false,
    total: 0,
    providerStats: buildProviderStats({
      mode: "unknown",
      amazonEnabled: false,
      ebayEnabled: false,
      amazonCacheHit: false,
      amazonBudgetRemaining: null,
      amazonReturned: 0,
      amazonCap: 0,
      amazonStatus: "disabled",
      ebayReturned: 0,
    }),
    searchMeta,
    durationMs: Date.now() - startTime,
    error: error || null,
  });

  // Empty query
  if (!qOriginal) {
    return new Response(JSON.stringify(buildEmptyResponse()), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Blocked content check (use original before rewrite)
  if (isBlockedSearchQuery(qOriginal)) {
    console.log(`[CATALOG_SEARCH] requestId=${requestId} BLOCKED query: "${qOriginal}"`);
    return new Response(JSON.stringify({
      ...buildEmptyResponse(),
      warning: { message: getBlockedSearchMessage(lang), code: "BLOCKED_CONTENT" },
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseKey) {
      return new Response(JSON.stringify(buildEmptyResponse({
        code: "CONFIG_ERROR",
        message: "Backend unavailable",
      })), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    // ─── PERF TRACKING ──────────────────────────────────────────────────────────
    const perfLog = { rewrite_ms: 0, settings_ms: 0, cache_ms: 0, amazon_ms: 0, ebay_ms: 0, mix_ms: 0, flags_ms: 0 };

    // ─── PLATFORM-AWARE FEATURE FLAGS (Proxy Engine Integration) ─────────────────
    // Check feature_flags table for platform-specific provider gating (iOS, Android, web)
    const flagsStart = Date.now();
    const clientPlatform = getClientPlatform(req);
    const enabledProviders = await getEnabledProviders(supabase, clientPlatform, providerParam);
    perfLog.flags_ms = Date.now() - flagsStart;
    
    console.log(`[CATALOG_SEARCH] requestId=${requestId} feature_check`, JSON.stringify({
      amazon: enabledProviders.amazon,
      ebay: enabledProviders.ebay,
      platform: clientPlatform || "all",
      requestedProvider: providerParam,
    }));

    // ─── RATE LIMITING (Proxy Engine Integration) ────────────────────────────────
    // Use same rate limit keys as market-search-proxy for consistency
    const clientIp = getClientIp(req);
    const rateLimitKey = `ip:${clientIp}:catalog-search`;
    const RATE_LIMIT_IP = 60;
    const RATE_LIMIT_WINDOW_MINUTES = 5;
    
    const { data: rateLimitResult, error: rateLimitError } = await supabase.rpc("check_rate_limit", {
      p_key: rateLimitKey,
      p_limit: RATE_LIMIT_IP,
      p_window_minutes: RATE_LIMIT_WINDOW_MINUTES,
    });
    
    if (!rateLimitError && rateLimitResult && !rateLimitResult.allowed) {
      console.log(`[CATALOG_SEARCH] requestId=${requestId} rate_limited key=${rateLimitKey}`);
      return new Response(JSON.stringify({
        ...buildEmptyResponse({ code: "RATE_LIMIT_EXCEEDED", message: "Too many requests. Please wait before trying again." }),
        retry_after: rateLimitResult.reset_at,
      }), {
        status: 200, // Keep 200 for mobile app compatibility
        headers: { 
          ...corsHeaders, 
          "Content-Type": "application/json",
          "X-RateLimit-Remaining": "0",
          "X-RateLimit-Reset": rateLimitResult.reset_at || "",
        },
      });
    }

    // ─── PARALLEL: REWRITE QUERY + LOAD SETTINGS ─────────────────────────────────
    // Run query rewrite and settings load concurrently (saves ~30-50ms)
    const rewriteStart = Date.now();
    const [searchMetaResult, settings] = await Promise.all([
      rewriteSearchQuery(supabase, qOriginal, {
        lang,
        categoryKey,
        requestId,
      }),
      getCatalogSettings(supabase),
    ]);
    
    searchMeta = searchMetaResult;
    perfLog.rewrite_ms = Date.now() - rewriteStart;
    perfLog.settings_ms = perfLog.rewrite_ms; // Ran in parallel
    
    const qNorm = searchMeta.rewrittenQuery; // Use rewritten query for searches
    
    if (searchMeta.rewriteApplied) {
      console.log(`[CATALOG_SEARCH] requestId=${requestId} Query rewritten: "${qOriginal}" → "${qNorm}"`);
    }

    // ─── EFFECTIVE MODE (Merge settings + feature flags) ─────────────────────────
    // Use feature_flags to override provider availability (platform-specific gating)
    const baseEffectiveMode = getEffectiveMode(settings, providerParam || undefined);
    const effectiveMode = {
      ...baseEffectiveMode,
      // Feature flags can disable providers, but cannot enable them if settings disable them
      amazonActive: baseEffectiveMode.amazonActive && enabledProviders.amazon,
      ebayActive: baseEffectiveMode.ebayActive && enabledProviders.ebay,
    };

    // Decode cursor first (needed for cache key)
    let mixerCursor = getInitialCursor();
    if (cursor) {
      const decoded = decodeMixerCursor(cursor);
      if (decoded) {
        mixerCursor = decoded;
      }
    }

    // ─── GLOBAL CACHE CHECK (EARLY) ───────────────────────────────────────────
    // Check for cached search results BEFORE calling providers for instant response
    const cacheStart = Date.now();
    
    // CRITICAL: Log cache key components for debugging cache misses
    console.log(`[CATALOG_SEARCH] requestId=${requestId} cache_key_params`, JSON.stringify({
      q: qNorm,
      provider: providerParam || "all",
      category: categoryKey || undefined,
      page: Math.floor(mixerCursor.ebayOffset / limit) + 1,
      pageSize: limit,
      minPrice: catalogFilters.minPrice,
      maxPrice: catalogFilters.maxPrice,
      sort,
      vehicleMode: hasBuyingIntent,
    }));
    
    const globalCacheKey = buildCacheKey("search", {
      env: envName,
      query: qNorm,
      provider: providerParam || "all",
      category: categoryKey || undefined,
      page: Math.floor(mixerCursor.ebayOffset / limit) + 1,
      pageSize: limit,
      // Include filters in cache key so different filter combinations have separate cached results
      minPrice: catalogFilters.minPrice,
      maxPrice: catalogFilters.maxPrice,
      brand: catalogFilters.brand?.join(","),
      rating: catalogFilters.rating,
      condition: catalogFilters.condition,
      // CRITICAL: Include sort and vehicleMode to prevent cache collisions
      sort,
      vehicleMode: hasBuyingIntent,
    });

    let cacheResult = await getCache(supabase, globalCacheKey);
    perfLog.cache_ms = Date.now() - cacheStart;

    // ═══════════════════════════════════════════════════════════════════════════
    // CACHE MISMATCH DETECTION (v3 POISON FIX):
    // Force cache miss if vehicleMode=true but cache key lacks vm=1 marker
    // This catches old v2 cache entries that didn't have proper vehicle filtering
    // ═══════════════════════════════════════════════════════════════════════════
    if (cacheResult.hit && hasBuyingIntent) {
      const cacheKeyHasVehicleMode = cacheResult.cacheKey.includes("vm=1");
      if (!cacheKeyHasVehicleMode) {
        console.warn(`[CATALOG_SEARCH] requestId=${requestId} CACHE_MISMATCH: vehicleMode=true but cache key lacks vm=1. Forcing miss. key=${cacheResult.cacheKey.substring(0, 80)}...`);
        cacheResult = { ...cacheResult, hit: false, stale: true };
      }
    }

    if (cacheResult.hit && !cacheResult.stale && !cacheResult.negativeCached) {
      // INSTANT RETURN: Fresh cache hit
      console.log(`[CATALOG_SEARCH] requestId=${requestId} cache_hit fresh (${cacheResult.cacheAgeSec}s old) key=${globalCacheKey.substring(0, 60)}...`);
      
      const cachedResponse = cacheResult.data;
      const instantDuration = Date.now() - startTime;
      
      // Apply post-filter to cached results as safety net (in case filters differ from cached version)
      let cachedItems = cachedResponse.items || [];
      const hasFiltersForCache = catalogFilters.minPrice !== undefined || 
                                 catalogFilters.maxPrice !== undefined ||
                                 catalogFilters.brand !== undefined ||
                                 catalogFilters.rating !== undefined;
      if (hasFiltersForCache && cachedItems.length > 0) {
        const beforeCount = cachedItems.length;
        cachedItems = postFilterItems(cachedItems, catalogFilters);
        console.log(`[CATALOG_SEARCH] requestId=${requestId} cache_postfilter: ${beforeCount} → ${cachedItems.length}`);
      }
      
      // ═══════════════════════════════════════════════════════════════════════════
      // VEHICLE CACHE POISONING FIX (DEFENSIVE FILTER):
      // Always enforce minPrice for vehicle searches even on cache hits
      // This catches any old cache entries that don't have proper vehicle filtering
      // ═══════════════════════════════════════════════════════════════════════════
      if (hasBuyingIntent && cachedItems.length > 0) {
        const beforeVehicleFilter = cachedItems.length;
        cachedItems = cachedItems.filter((item: any) => {
          const price = item.priceUsd ?? item.price_usd ?? 0;
          return price >= 1000;
        });
        if (beforeVehicleFilter !== cachedItems.length) {
          console.log(`[CATALOG_SEARCH] requestId=${requestId} vehicle_cache_filter: ${beforeVehicleFilter} → ${cachedItems.length} (enforced minPrice=1000)`);
        }
        
        // ACCESSORY KEYWORD FILTER: Remove obvious toy/accessory results from vehicle cache
        const ACCESSORY_TITLE_KEYWORDS = [
          "matchbox", "diecast", "1:64", "1:43", "1:24", "1:18", "hot wheels",
          "floor mat", "key fob", "fob cover", "key cover", "remote cover",
          "phone case", "phone holder", "car mount", "decal", "sticker",
          "poster", "wall art", "canvas", "model car", "toy car",
          "scale model", "die cast", "die-cast", "miniature"
        ];
        const beforeAccessoryFilter = cachedItems.length;
        cachedItems = cachedItems.filter((item: any) => {
          const title = (item.title || "").toLowerCase();
          return !ACCESSORY_TITLE_KEYWORDS.some(kw => title.includes(kw));
        });
        if (beforeAccessoryFilter !== cachedItems.length) {
          console.log(`[CATALOG_SEARCH] requestId=${requestId} accessory_title_filter: ${beforeAccessoryFilter} → ${cachedItems.length}`);
        }
      }
      
      return new Response(JSON.stringify({
        ...cachedResponse,
        items: cachedItems, // Use filtered items
        total: cachedItems.length,
        query: qOriginal, // Use original query for display
        env: envName,
        durationMs: instantDuration,
        _cacheHit: true,
        _cacheAgeSec: cacheResult.cacheAgeSec,
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Track if we should do stale-while-revalidate
    const isStaleCache = cacheResult.hit && cacheResult.stale && !cacheResult.negativeCached;
    if (isStaleCache) {
      console.log(`[CATALOG_SEARCH] requestId=${requestId} cache_stale (${cacheResult.cacheAgeSec}s old) - will refresh`);
    }

    console.log(`[CATALOG_SEARCH] requestId=${requestId} effective_mode`, JSON.stringify({ mode: effectiveMode.mode, amazon: effectiveMode.amazonActive, ebay: effectiveMode.ebayActive }));

    const isVehicle = isVehicleQuery(qNorm);
    const page = Math.floor(mixerCursor.ebayOffset / limit) + 1;

    // ═══════════════════════════════════════════════════════════════════════════
    // VEHICLE SEARCH POLICY:
    // - Amazon uses Amazon Autos category (node 10677469011) for actual vehicle listings
    // - eBay Motors category 6001 (Cars & Trucks) is used for actual vehicle listings
    // - This ensures both providers return real vehicles, not parts/accessories
    // ═══════════════════════════════════════════════════════════════════════════
    
    if (isVehicle) {
      console.log(`[CATALOG_SEARCH] requestId=${requestId} vehicle_query: "${qNorm}" - using eBay Motors + Amazon Autos`);
    }

    // ─── PARALLEL PROVIDER FETCH ──────────────────────────────────────────────
    // Run Amazon and eBay fetches concurrently for ~50% faster initial searches
    const providerStartMs = Date.now();

    const [amazonSettled, ebaySettled] = await Promise.allSettled([
      // Amazon fetch (only if active)
      fetchAmazonItems({
        supabase,
        query: qNorm,
        settings,
        effectiveMode,
        mixerCursor,
        isVehicle,
        hasBuyingIntent,  // NEW: Pass buying intent for minPrice enforcement at Amazon level
        categoryKey: categoryKey || undefined,
        limit,
        catalogFilters,   // NEW: Pass filters for minPrice/maxPrice at Amazon level
        requestId,
      }),
      // eBay fetch (only if active)
      fetchEbayItems({
        supabase,
        query: qNorm,
        effectiveMode,
        isVehicle,
        hasBuyingIntent,  // Pass smart intent flag to control minPrice and category
        categoryKey: categoryKey || undefined,
        page,
        limit,
        catalogFilters,
        requestId,
      }),
    ]);

    const providerMs = Date.now() - providerStartMs;

    // Extract Amazon results safely
    let amazonItems: CatalogItem[] = [];
    let amazonHasMore = false;
    let amazonCacheHit = false;
    let amazonBudgetRemaining: number | null = null;
    let amazonStatus: AmazonStatusInfo["status"] = "disabled";
    let amazonLiveUsed = false;
    let amazonLiveReason: AmazonLiveReason = "disabled";

    if (amazonSettled.status === "fulfilled") {
      const result = amazonSettled.value;
      amazonItems = result.items;
      amazonHasMore = result.hasMore;
      amazonCacheHit = result.cacheHit;
      amazonBudgetRemaining = result.budgetRemaining;
      amazonStatus = result.status;
      amazonLiveUsed = result.liveUsed;
      amazonLiveReason = result.liveReason;
    } else {
      console.error(`[CATALOG_SEARCH] requestId=${requestId} amazon_err:`, amazonSettled.reason);
      amazonStatus = "error";
    }

    // Extract eBay results safely
    let ebayItems: CatalogItem[] = [];
    let ebayHasMore = false;
    let ebayTotal = 0;

    if (ebaySettled.status === "fulfilled") {
      const result = ebaySettled.value;
      ebayItems = result.items;
      ebayHasMore = result.hasMore;
      ebayTotal = result.total;
    } else {
      console.error(`[CATALOG_SEARCH] requestId=${requestId} ebay_err:`, ebaySettled.reason);
    }

    console.log(`[CATALOG_SEARCH] requestId=${requestId} providers_ok`, JSON.stringify({ amazon: amazonItems.length, ebay: ebayItems.length, durationMs: providerMs }));

    // ─── MIX RESULTS ──────────────────────────────────────────────────────────
    // UNIFIED: Use same mixer as catalog-category for consistent behavior

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
      categoryKey: categoryKey || "search",
      requestId,
    });

    // Log mixer debug info (first page only for performance)
    if (!cursor) {
      logMixerDebug(mixResult, requestId, categoryKey || "search");
    }

    // Filter disallowed content from mixed results
    const { allowed: filteredItems, removed: removedCount } = filterDisallowedItems(
      mixResult.items.map(item => ({
        ...item,
        title: (item as CatalogItem).title,
        productUrl: (item as CatalogItem).productUrl,
        category: (item as CatalogItem).category,
      })),
      `[SEARCH] requestId=${requestId}`
    );

    const allowedIds = new Set(filteredItems.map(i => i.id));
    const filteredFinalItems = mixResult.items.filter(item => allowedIds.has(item.id)) as CatalogItem[];

    // Enrich items with exact image counts from media cache
    const { items: enrichedItems, stats: mediaStats } = await enrichItemsWithMediaCounts(
      supabase,
      filteredFinalItems as unknown as Record<string, unknown>[]
    );

    // Map enriched items back to CatalogItem type with updated counts
    let finalItems = filteredFinalItems.map((item, idx) => ({
      ...item,
      imageCount: (enrichedItems[idx] as Record<string, unknown>).image_count as number || item.imageCount,
      image_count_status: (enrichedItems[idx] as Record<string, unknown>).image_count_status as string | undefined,
    }));

    // ─── APPLY USER FILTERS ────────────────────────────────────────────────────
    // Apply post-filters for price, brand, rating that weren't applied at provider level
    const hasFilters = catalogFilters.minPrice !== undefined || 
                       catalogFilters.maxPrice !== undefined || 
                       catalogFilters.brand !== undefined || 
                       catalogFilters.rating !== undefined;
    
    if (hasFilters) {
      const beforeFilterCount = finalItems.length;
      finalItems = postFilterItems(finalItems, catalogFilters) as typeof finalItems;
      console.log(`[SEARCH] requestId=${requestId} PostFilter: ${beforeFilterCount} → ${finalItems.length} items, filters=${JSON.stringify(catalogFilters)}`);
    }

    // ─── APPLY USER SORT ───────────────────────────────────────────────────────
    // Apply post-sort if user requested a specific sort order
    if (sort !== 'relevance') {
      finalItems = postSortItems(finalItems, sort) as typeof finalItems;
      console.log(`[SEARCH] requestId=${requestId} PostSort applied: ${sort}`);
    }

    console.log(`[CATALOG_SEARCH] requestId=${requestId} media_stats checked=${mediaStats.checked} cacheHit=${mediaStats.cacheHit} fetched=${mediaStats.fetched} timeout=${mediaStats.timedOut}`);

    // Build sourceServed array (matches market-search-proxy format)
    const sourceServed: ("ebay" | "amazon")[] = [];
    if (ebayItems.length > 0) sourceServed.push("ebay");
    if (amazonItems.length > 0) sourceServed.push("amazon");

    // Build provider stats with mixing configuration for transparency
    const providerStats = {
      ...buildProviderStats({
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
      }),
      amazonLiveUsed,
      amazonLiveReason,
      // Add sourceServed for proxy engine compatibility
      sourceServed,
      sourceRequested: providerParam || "mixed",
      platformGating: {
        clientPlatform: clientPlatform || "all",
        amazonGated: !enabledProviders.amazon,
        ebayGated: !enabledProviders.ebay,
      },
    };

    // Log mixer request summary
    logMixerRequest({
      mode: effectiveMode.mode,
      query: qNorm,
      amazonLiveUsed,
      amazonLiveReason,
      amazonReturned: mixResult.amazonReturned,
      ebayReturned: mixResult.ebayReturned,
      budgetRemaining: amazonBudgetRemaining,
      amazonCacheHit,
      requestId,
    });

    // Build next cursor
    const nextCursor = mixResult.nextCursor ? encodeMixerCursor(mixResult.nextCursor) : null;

    const durationMs = Date.now() - startTime;
    
    // Log detailed performance breakdown (with flags_ms from proxy engine integration)
    console.log(`[CATALOG_SEARCH] requestId=${requestId} perf`, JSON.stringify({
      flags_ms: perfLog.flags_ms,
      rewrite_settings_ms: perfLog.rewrite_ms,
      cache_check_ms: perfLog.cache_ms,
      provider_parallel_ms: providerMs,
      amazon_count: amazonItems.length,
      ebay_count: ebayItems.length,
      amazon_status: amazonStatus,
      total_ms: durationMs,
      items_returned: finalItems.length,
      cache_hit: false,
      sourceServed,
    }));
    
    console.log(`[CATALOG_SEARCH] requestId=${requestId} response items=${finalItems.length} mode=${effectiveMode.mode} phase=${mixResult.mixingPhase} durationMs=${durationMs}`);

    const DEV = Deno.env.get("ENVIRONMENT") !== "production";

    const response: SearchResponse = {
      status: "success",
      env: envName,
      query: qOriginal,
      items: finalItems,
      nextCursor,
      hasMore: mixResult.hasMore,
      total: Math.max(ebayTotal, amazonItems.length, finalItems.length),
      appliedFilters: buildAppliedSortFilter(sort, catalogFilters, sort !== 'relevance'),
      providerStats,
      searchMeta, // Include query rewrite metadata
      mediaStats: DEV ? mediaStats : undefined, // Include media stats in dev only
      durationMs,
      error: null,
    };

    // ─── CACHE FINAL RESPONSE ──────────────────────────────────────────────────
    // Store for instant retrieval by subsequent users (async, don't wait)
    // Only cache if we have results (positive cache)
    if (finalItems.length > 0) {
      setCache(supabase, "search", globalCacheKey, response, {
        provider: "mixed",
        query: qNorm,
        category: categoryKey || undefined,
        page: Math.floor(mixerCursor.ebayOffset / limit) + 1,
        pageSize: limit,
        amazonDomain: "amazon.com",
      }).catch(err => console.warn(`[CATALOG_SEARCH] requestId=${requestId} Cache write failed:`, err));
      
      console.log(`[CATALOG_SEARCH] requestId=${requestId} cache_write key=${globalCacheKey.substring(0, 60)}...`);
    }

    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "Unknown error";
    console.error(`[CATALOG_SEARCH] requestId=${requestId} error:`, errorMessage);

    return new Response(JSON.stringify(buildEmptyResponse({
      code: "INTERNAL_ERROR",
      message: "Search service error",
    })), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
