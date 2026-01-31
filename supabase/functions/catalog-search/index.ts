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
  "car", "cars", "truck", "trucks", "suv", "sedan", "pickup",
  "toyota", "honda", "jeep", "bmw", "mercedes", "ford", "chevy", "chevrolet",
  "nissan", "kia", "hyundai", "lexus", "audi", "tesla", "mazda", "subaru",
  "motorcycle", "harley", "yamaha", "kawasaki", "ducati",
  "boat", "pontoon", "yacht", "rv", "camper", "trailer",
  "atv", "utv", "quad", "polaris", "can-am",
  // French vehicle terms
  "voiture", "voitures", "moto", "camion", "vehicule",
];

const DEFAULT_LIMIT = 24;
const MAX_LIMIT = 60;

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
  
  return {
    id: item.id,
    provider: "ebay",
    providerProductId: item.provider_product_id,
    title: item.title,
    priceUsd: item.price_usd,
    currency: item.currency,
    mainImageUrl: mainImage,
    imageUrl: mainImage,  // Backward compat
    imageCount: item.image_count || 1,  // Total images available
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
  
  // Fallback to first in images array
  const imagesArray = Array.isArray(item.images) ? item.images : [];
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

  // Initialize search metadata (will be populated by rewriter)
  let searchMeta: SearchMeta = {
    originalQuery: qOriginal,
    normalizedQuery: qOriginal.toLowerCase().replace(/\s+/g, " "),
    rewrittenQuery: qOriginal.toLowerCase().replace(/\s+/g, " "),
    rewriteApplied: false,
    ruleId: null,
    rulePriority: null,
    categoryKey,
  };

  console.log(`[SEARCH] requestId=${requestId} q="${qOriginal}" category_key=${categoryKey} cursor=${cursor} limit=${limit} provider=${providerParam} lang=${lang}`);

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

    // Load settings
    const settings = await getCatalogSettings(supabase);
    const effectiveMode = getEffectiveMode(settings, providerParam || undefined);

    console.log(`[CATALOG_MODE] requestId=${requestId} mode=${effectiveMode.mode} amazon=${effectiveMode.amazonActive} ebay=${effectiveMode.ebayActive}`);

    // Decode cursor
    let mixerCursor = getInitialCursor();
    if (cursor) {
      const decoded = decodeMixerCursor(cursor);
      if (decoded) {
        mixerCursor = decoded;
      }
    }

    const isVehicle = isVehicleQuery(qNorm);
    const page = Math.floor(mixerCursor.ebayOffset / limit) + 1;

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
            console.log(`[SEARCH] requestId=${requestId} Amazon LIVE search: "${qNorm}" page=${mixerCursor.amazonPage}`);
            
            const liveResult = await searchRainforest(qNorm, mixerCursor.amazonPage, limit, "amazon.com");
            
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
                imageCount: 1,
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
                  images: p.imageUrl ? [p.imageUrl] : [],
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
            // Try cache first
            const cacheKey = buildAmazonCacheKey({ query: qNorm, categoryKey, page: mixerCursor.amazonPage });
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
                imageCount: 1,
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
              // Fall back to DB search
              console.log(`[SEARCH] requestId=${requestId} Amazon DB search: "${qNorm}" category_key=${categoryKey}`);

              let amazonQuery = supabase
                .from("catalog_items")
                .select("*", { count: "exact" })
                .or("provider.eq.rainforest,provider.eq.amazon")
                .or(`title.ilike.%${qNorm}%,search_text.ilike.%${qNorm}%`);

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

        console.log(`[SEARCH] requestId=${requestId} eBay LIVE: q="${qNorm}" isVehicle=${isVehicle} ebayCategory=${ebayCategory}`);

        const ebayResult = await searchEbay(
          supabase,
          {
            query: qNorm,
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
    const finalItems = filteredFinalItems.map((item, idx) => ({
      ...item,
      imageCount: (enrichedItems[idx] as Record<string, unknown>).image_count as number || item.imageCount,
      image_count_status: (enrichedItems[idx] as Record<string, unknown>).image_count_status as string | undefined,
    }));

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
      providerStats,
      searchMeta, // Include query rewrite metadata
      mediaStats: DEV ? mediaStats : undefined, // Include media stats in dev only
      durationMs,
      error: null,
    };

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
