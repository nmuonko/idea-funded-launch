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

// ─── MAIN HANDLER ─────────────────────────────────────────────────────────────

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
  // Detect vehicle intent BEFORE filters are applied to override restrictive price limits
  const qNormEarly = qOriginal.toLowerCase().replace(/\s+/g, " ");
  const isVehicleEarly = isVehicleQuery(qNormEarly);
  
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
  
  // Ensure minPrice is at least $1500 for vehicles to exclude parts/accessories
  if (isVehicleEarly && (catalogFilters.minPrice === undefined || catalogFilters.minPrice < 1500)) {
    catalogFilters.minPrice = 1500;
    console.log(`[SEARCH] requestId=${requestId} Vehicle search: enforcing minPrice=$1500 to exclude parts`);
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

  console.log(`[SEARCH] requestId=${requestId} q="${qOriginal}" category_key=${categoryKey} cursor=${cursor} limit=${limit} provider=${providerParam} lang=${lang} isVehicle=${isVehicleEarly}`);

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
    console.log(`[SEARCH] requestId=${requestId} BLOCKED query: "${qOriginal}"`);
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

    // ─── REWRITE QUERY ────────────────────────────────────────────────────────
    // Rewrite French queries to English for better provider results
    searchMeta = await rewriteSearchQuery(supabase, qOriginal, {
      lang,
      categoryKey,
      requestId,
    });
    
    const qNorm = searchMeta.rewrittenQuery; // Use rewritten query for searches
    
    if (searchMeta.rewriteApplied) {
      console.log(`[SEARCH] requestId=${requestId} Query rewritten: "${qOriginal}" → "${qNorm}"`);
    }

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
    const globalCacheKey = buildCacheKey("search", {
      env: envName,
      query: qNorm,
      provider: providerParam || "all",
      category: categoryKey || undefined,
      page: Math.floor(mixerCursor.ebayOffset / limit) + 1,
      pageSize: limit,
    });

    const cacheResult = await getCache(supabase, globalCacheKey);

    if (cacheResult.hit && !cacheResult.stale && !cacheResult.negativeCached) {
      // INSTANT RETURN: Fresh cache hit
      console.log(`[SEARCH] requestId=${requestId} GLOBAL CACHE HIT (${cacheResult.cacheAgeSec}s old) key=${globalCacheKey.substring(0, 60)}...`);
      
      const cachedResponse = cacheResult.data;
      const instantDuration = Date.now() - startTime;
      
      return new Response(JSON.stringify({
        ...cachedResponse,
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
      console.log(`[SEARCH] requestId=${requestId} STALE CACHE (${cacheResult.cacheAgeSec}s old) - will refresh`);
    }

    // Load settings
    const settings = await getCatalogSettings(supabase);
    const effectiveMode = getEffectiveMode(settings, providerParam || undefined);

    console.log(`[CATALOG_MODE] requestId=${requestId} mode=${effectiveMode.mode} amazon=${effectiveMode.amazonActive} ebay=${effectiveMode.ebayActive}`)

    const isVehicle = isVehicleQuery(qNorm);
    const page = Math.floor(mixerCursor.ebayOffset / limit) + 1;

    // ═══════════════════════════════════════════════════════════════════════════
    // VEHICLE SEARCH POLICY:
    // - Amazon uses Amazon Autos category (node 10677469011) for actual vehicle listings
    // - eBay Motors category 6001 (Cars & Trucks) is used for actual vehicle listings
    // - This ensures both providers return real vehicles, not parts/accessories
    // ═══════════════════════════════════════════════════════════════════════════
    
    // Amazon Autos category ID for vehicle-specific searches
    const AMAZON_AUTOS_CATEGORY_ID = "10677469011";
    
    if (isVehicle) {
      console.log(`[SEARCH] requestId=${requestId} Vehicle query detected: "${qNorm}" - using eBay Motors + Amazon Autos (category=${AMAZON_AUTOS_CATEGORY_ID})`);
    }

    // ─── FETCH FROM PROVIDERS ─────────────────────────────────────────────────

    let amazonItems: CatalogItem[] = [];
    let ebayItems: CatalogItem[] = [];
    let amazonHasMore = false;
    let ebayHasMore = false;
    let ebayTotal = 0;
    let amazonCacheHit = false;
    let amazonBudgetRemaining: number | null = null;
    let amazonStatus: AmazonStatusInfo["status"] = "disabled";
    let amazonLiveUsed = false;
    let amazonLiveReason: AmazonLiveReason = "disabled";

    // ─── Amazon (Smart Live + Cache) ──────────────────────────────────────────
    // VEHICLE SEARCH: Use Amazon Autos category to get actual vehicle listings
    // instead of skipping Amazon entirely
    if (effectiveMode.amazonActive && effectiveMode.mode !== "ebay") {
      try {
        // Check budget
        const budgetStatus = await checkBudget(
          supabase,
          "amazon",
          settings.amazonBudgetWindow,
          settings.amazonMaxCallsPerHour,
          requestId
        );
        amazonBudgetRemaining = budgetStatus.remaining;

        // Load live settings
        const liveSettings = await getAmazonLiveSettings(supabase);

        // Check if cap hit for this query
        const queryCapHit = mixerCursor.amazonReturnedSoFar >= settings.amazonMaxResultsPerQuery;

        if (queryCapHit) {
          amazonStatus = "cap_exhausted";
          amazonLiveReason = "cache_only";
          console.log(`[SEARCH] requestId=${requestId} Amazon cap exhausted: ${mixerCursor.amazonReturnedSoFar}/${settings.amazonMaxResultsPerQuery}`);
        } else {
          // Determine if we should use live API
          const liveDecision = shouldUseAmazonLive({
            endpoint: "search",
            query: qNorm,
            amazonPage: mixerCursor.amazonPage,
            amazonEnabled: effectiveMode.amazonActive,
            budgetAllowed: budgetStatus.allowed,
            budgetRemaining: budgetStatus.remaining,
            liveSettings,
            requestId,
          });

          amazonLiveReason = liveDecision.reason;

          if (liveDecision.useLive) {
            // ─── LIVE RAINFOREST API ─────────────────────────────────────────
            // For vehicle searches, use Amazon Autos category to get actual vehicles
            const amazonSearchQuery = qNorm;
            const vehicleCategoryId = isVehicle ? AMAZON_AUTOS_CATEGORY_ID : undefined;
            console.log(`[SEARCH] requestId=${requestId} Amazon LIVE search: "${amazonSearchQuery}" page=${mixerCursor.amazonPage}${vehicleCategoryId ? ` category=${vehicleCategoryId}` : ""}`);
            
            const liveResult = await searchRainforest(amazonSearchQuery, mixerCursor.amazonPage, limit, "amazon.com", "relevance", undefined, vehicleCategoryId);
            
            if (!liveResult.error && liveResult.products.length > 0) {
              amazonLiveUsed = true;
              amazonStatus = "live";

              // Increment budget after successful call
              await incrementBudget(supabase, "amazon", settings.amazonBudgetWindow, requestId);
              amazonBudgetRemaining = Math.max(0, (amazonBudgetRemaining || 0) - 1);

              // Map live products to CatalogItem format
              amazonItems = liveResult.products.map(p => ({
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
              amazonHasMore = liveResult.hasMore;

              // Cache the live results for future pages
              const cacheKey = buildAmazonCacheKey({ query: qNorm, categoryKey, page: mixerCursor.amazonPage });
              const now = new Date();
              const cacheTtlSeconds = settings.searchCacheTtlSeconds || 172800;
              const expiresAt = new Date(now.getTime() + cacheTtlSeconds * 1000);
              const staleAt = new Date(now.getTime() + (cacheTtlSeconds / 2) * 1000);

              supabase.from("catalog_cache").upsert({
                cache_key: cacheKey,
                cache_type: "search_amazon",
                provider: "rainforest",
                query: qNorm,
                category: categoryKey,
                page: mixerCursor.amazonPage,
                response: { products: liveResult.products, total: liveResult.total, hasMore: liveResult.hasMore },
                expires_at: expiresAt.toISOString(),
                stale_at: staleAt.toISOString(),
                updated_at: now.toISOString(),
              }, { onConflict: "cache_key" });

              // Upsert into catalog_items for future DB queries
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

              console.log(`[SEARCH] requestId=${requestId} Amazon LIVE returned ${amazonItems.length} items`);
            }
          }

          // If no live results or live not used, fall back to cache/DB
          if (amazonItems.length === 0) {
            // Note: For vehicle searches, this block is skipped (Amazon excluded)
            const amazonSearchQuery = qNorm;
            
            // Try cache first
            const cacheKey = buildAmazonCacheKey({ query: amazonSearchQuery, categoryKey, page: mixerCursor.amazonPage });
            const { data: cachedData } = await supabase
              .from("catalog_cache")
              .select("response, expires_at")
              .eq("cache_key", cacheKey)
              .gt("expires_at", new Date().toISOString())
              .single();

            if (cachedData?.response) {
              const cached = cachedData.response as { products: Array<Record<string, unknown>>; hasMore: boolean };
              amazonItems = cached.products.map(p => ({
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
              amazonHasMore = cached.hasMore;
              amazonCacheHit = true;
              amazonStatus = "cached";
              console.log(`[SEARCH] requestId=${requestId} Amazon CACHE hit: ${amazonItems.length} items`);
            } else {
              // Fall back to DB search - for vehicles include automotive category
              const dbSearchQuery = isVehicle ? `${qNorm}|automotive|car parts|auto` : qNorm;
              console.log(`[SEARCH] requestId=${requestId} Amazon DB search: "${dbSearchQuery}" category_key=${categoryKey}`);

              let amazonQuery = supabase
                .from("catalog_items")
                .select("*", { count: "exact" })
                .or("provider.eq.rainforest,provider.eq.amazon")
                .or(`title.ilike.%${qNorm}%,search_text.ilike.%${qNorm}%${isVehicle ? ',unified_category.eq.automotive,title.ilike.%car%,title.ilike.%auto%' : ''}`);

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
                amazonItems = amazonData.map(item => {
                  const mapped = mapDbItemToResponse(item as Record<string, unknown>);
                  if (categoryKey) {
                    mapped.category = categoryKey;
                  }
                  return mapped;
                });
                amazonHasMore = (count || 0) > mixerCursor.amazonReturnedSoFar + amazonData.length;
                amazonCacheHit = true;
                amazonStatus = "cached";
                console.log(`[SEARCH] requestId=${requestId} Amazon DB returned ${amazonItems.length} items`);
              }
            }
          }
        }
      } catch (err) {
        console.error(`[SEARCH] requestId=${requestId} Amazon error:`, err);
        amazonStatus = "error";
      }
    }

    // ─── eBay LIVE Search ─────────────────────────────────────────────────────
    if (effectiveMode.ebayActive && effectiveMode.mode !== "amazon") {
      try {
        const minPrice = isVehicle ? 1500 : undefined;
        
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

        // ═══════════════════════════════════════════════════════════════════════════
        // VEHICLE SEARCH FIX: When searching for car makes/models, force eBay Motors
        // category to get actual vehicles, not parts from general search
        // ═══════════════════════════════════════════════════════════════════════════
        let enhancedQuery = qNorm;
        if (isVehicle && !ebayCategory) {
          // Force eBay Motors > Cars & Trucks category for vehicle searches
          ebayCategory = "6001"; // Cars & Trucks category
          
          // DON'T modify the query for specific car models - just use the category filter
          // Adding "car for sale" to "tesla model 3" makes results too restrictive
          console.log(`[SEARCH] requestId=${requestId} Vehicle search detected, forcing category=6001 for query="${qNorm}"`);
        }

        console.log(`[SEARCH] requestId=${requestId} eBay LIVE: q="${enhancedQuery}" isVehicle=${isVehicle} ebayCategory=${ebayCategory}`);

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

          ebayItems = filteredItems.map(mapEbayItemToResponse);
          ebayTotal = ebayResult.total;
          ebayHasMore = ebayResult.hasMore;

          console.log(`[SEARCH] requestId=${requestId} eBay returned ${ebayItems.length} items, total=${ebayTotal}`);

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
    }

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

    console.log(`[SEARCH_MEDIA] requestId=${requestId} checked=${mediaStats.checked} cacheHit=${mediaStats.cacheHit} fetched=${mediaStats.fetched} timeout=${mediaStats.timedOut}`);

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
    console.log(`[SEARCH] requestId=${requestId} Done: ${finalItems.length} items, mode=${effectiveMode.mode}, phase=${mixResult.mixingPhase}, durationMs=${durationMs}`);

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
      }).catch(err => console.warn(`[SEARCH] requestId=${requestId} Cache write failed:`, err));
      
      console.log(`[SEARCH] requestId=${requestId} Cached response for key=${globalCacheKey.substring(0, 60)}...`);
    }

    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "Unknown error";
    console.error(`[SEARCH] requestId=${requestId} error:`, errorMessage);

    return new Response(JSON.stringify(buildEmptyResponse({
      code: "INTERNAL_ERROR",
      message: "Search service error",
    })), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
