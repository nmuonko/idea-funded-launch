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
 * 
 * ALWAYS returns HTTP 200 with stable JSON
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { getEnvironmentFromRequest, EnvironmentName } from "../_shared/environmentResolver.ts";
import { searchEbay, NormalizedItem } from "../_shared/ebayBrowseSearch.ts";
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
  imageUrl: string | null;
  images: string[];
  productUrl: string | null;
  inStock: boolean | null;
  rating: number | null;
  category?: string;
  subcategory?: string;
  condition?: string;
  shippingPrice?: number | null;
  location?: string | null;
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
  appliedFilters?: Record<string, unknown>;
  providerStats: ProviderStats;
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

function mapEbayItemToResponse(item: NormalizedItem): CatalogItem {
  const metadata = item.metadata || {};
  return {
    id: item.id,
    provider: "ebay",
    providerProductId: item.provider_product_id,
    title: item.title,
    priceUsd: item.price_usd,
    currency: item.currency,
    imageUrl: item.image_url,
    images: item.images,
    productUrl: item.product_url,
    inStock: item.in_stock,
    rating: item.rating,
    condition: (metadata.condition as string) || undefined,
    shippingPrice: (metadata.shipping_price as number) || null,
    location: (metadata.location as string) || null,
  };
}

function mapDbItemToResponse(item: Record<string, unknown>): CatalogItem {
  return {
    id: item.id as string,
    provider: (item.provider as string) || "amazon",
    providerProductId: item.provider_product_id as string,
    title: item.title as string | null,
    priceUsd: item.price_usd as number | null,
    currency: "USD",
    imageUrl: item.image_url as string | null,
    images: (item.images as string[]) || [],
    productUrl: item.product_url as string | null,
    inStock: item.in_stock as boolean | null,
    rating: item.rating as number | null,
    category: item.unified_category as string | undefined,
    subcategory: item.unified_subcategory as string | undefined,
  };
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
  const qNorm = qOriginal.toLowerCase().replace(/\s+/g, " ");
  const cursor = url.searchParams.get("cursor") || null;
  const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(url.searchParams.get("limit") || String(DEFAULT_LIMIT), 10)));
  const providerParam = url.searchParams.get("provider") || null;
  const lang = url.searchParams.get("lang") || "fr";
  const envName = getEnvironmentFromRequest(req);

  console.log(`[SEARCH] requestId=${requestId} q="${qOriginal}" cursor=${cursor} limit=${limit} provider=${providerParam}`);

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
    durationMs: Date.now() - startTime,
    error: error || null,
  });

  // Empty query
  if (!qNorm) {
    return new Response(JSON.stringify(buildEmptyResponse()), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Blocked content check
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

    // ─── Amazon (DB-cached only) ──────────────────────────────────────────────
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

        // Check if cap hit for this query
        const queryCapHit = mixerCursor.amazonReturnedSoFar >= settings.amazonMaxResultsPerQuery;

        if (queryCapHit) {
          amazonStatus = "cap_exhausted";
          console.log(`[SEARCH] requestId=${requestId} Amazon cap exhausted: ${mixerCursor.amazonReturnedSoFar}/${settings.amazonMaxResultsPerQuery}`);
        } else if (!budgetStatus.allowed) {
          amazonStatus = "budget_exceeded";
          console.log(`[AMAZON_BUDGET] requestId=${requestId} Budget exceeded`);
        } else {
          // Fetch from DB (cached Amazon data)
          console.log(`[SEARCH] requestId=${requestId} Amazon DB search: "${qNorm}"`);

          const { data: amazonData, count } = await supabase
            .from("catalog_items")
            .select("*", { count: "exact" })
            .or("provider.eq.rainforest,provider.eq.amazon")
            .or(`title.ilike.%${qNorm}%,search_text.ilike.%${qNorm}%`)
            .order("rating", { ascending: false, nullsFirst: false })
            .range(
              mixerCursor.amazonReturnedSoFar,
              mixerCursor.amazonReturnedSoFar + limit - 1
            );

          if (amazonData && amazonData.length > 0) {
            amazonItems = amazonData.map(item => mapDbItemToResponse(item as Record<string, unknown>));
            amazonHasMore = (count || 0) > mixerCursor.amazonReturnedSoFar + amazonData.length;
            amazonCacheHit = true;
            amazonStatus = "cached";
            console.log(`[SEARCH] requestId=${requestId} Amazon DB returned ${amazonItems.length} items`);
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

        console.log(`[SEARCH] requestId=${requestId} eBay LIVE: q="${qNorm}" isVehicle=${isVehicle}`);

        const ebayResult = await searchEbay(
          supabase,
          {
            query: qNorm,
            page,
            pageSize: limit,
            minPrice,
            isVehicle,
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
    });

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
    const finalItems = mixResult.items.filter(item => allowedIds.has(item.id)) as CatalogItem[];

    // Build provider stats
    const providerStats = buildProviderStats({
      mode: effectiveMode.mode,
      amazonEnabled: effectiveMode.amazonActive,
      ebayEnabled: effectiveMode.ebayActive,
      amazonCacheHit,
      amazonBudgetRemaining,
      amazonReturned: mixResult.amazonReturned,
      amazonCap: settings.amazonMaxResultsPerQuery,
      amazonStatus,
      ebayReturned: mixResult.ebayReturned,
    });

    // Build next cursor
    const nextCursor = mixResult.nextCursor ? encodeMixerCursor(mixResult.nextCursor) : null;

    const durationMs = Date.now() - startTime;
    console.log(`[SEARCH] requestId=${requestId} Done: ${finalItems.length} items, mode=${effectiveMode.mode}, phase=${mixResult.mixingPhase}, durationMs=${durationMs}`);

    const response: SearchResponse = {
      status: "success",
      env: envName,
      query: qOriginal,
      items: finalItems,
      nextCursor,
      hasMore: mixResult.hasMore,
      total: Math.max(ebayTotal, amazonItems.length, finalItems.length),
      providerStats,
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
