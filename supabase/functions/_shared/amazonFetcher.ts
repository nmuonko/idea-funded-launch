/**
 * Amazon Fetcher - Shared Amazon/Rainforest search logic
 * Used by catalog-search and catalog-category
 * 
 * OFFLINE-ONLY: Users NEVER trigger live Rainforest API calls.
 * All Amazon data is served from catalog_items / catalog_cache.
 * Cache misses are enqueued to amazon_ingest_queue for background ingestion.
 */

// Use 'any' type to avoid importing the Supabase SDK (prevents bundle bloat)
type SupabaseClientAny = any;

import { mapCategoryAndSubcategory } from "./categoryMapper.ts";
import { CatalogSettings } from "./catalogSettings.ts";
import { AmazonStatusInfo } from "./providerBudget.ts";
import { MixerCursor } from "./providerMixer.ts";
import { 
  buildAmazonCacheKey,
  AmazonLiveReason,
} from "./amazonLivePolicy.ts";
import { CatalogFilters } from "./sortFilterNormalizer.ts";
import { 
  CatalogItem, 
  mapDbItemToResponse, 
} from "./catalogItemMapper.ts";
import { upgradeAmazonImage } from "./imageUpgrade.ts";

export interface AmazonFetchParams {
  supabase: SupabaseClientAny;
  query: string;
  settings: CatalogSettings;
  effectiveMode: { amazonActive: boolean; mode: string };
  mixerCursor: MixerCursor;
  isVehicle: boolean;
  hasBuyingIntent: boolean;
  isHeavyEquipment?: boolean;
  categoryKey: string | undefined;
  limit: number;
  catalogFilters: CatalogFilters;
  requestId: string;
}

export interface AmazonFetchResult {
  items: CatalogItem[];
  hasMore: boolean;
  cacheHit: boolean;
  budgetRemaining: number | null;
  status: AmazonStatusInfo["status"];
  liveUsed: boolean;
  liveReason: AmazonLiveReason;
}

const AMAZON_AUTOS_CATEGORY_ID = "10677469011";

export async function fetchAmazonItems(params: AmazonFetchParams): Promise<AmazonFetchResult> {
  const { supabase, query, settings, effectiveMode, mixerCursor, isVehicle, hasBuyingIntent, isHeavyEquipment, categoryKey, limit, catalogFilters, requestId } = params;
  
  let items: CatalogItem[] = [];
  let hasMore = false;
  let cacheHit = false;
  const budgetRemaining: number | null = null;
  let status: AmazonStatusInfo["status"] = "disabled";
  const liveUsed = false;
  const liveReason: AmazonLiveReason = "cache_only";

  if (!effectiveMode.amazonActive || effectiveMode.mode === "ebay") {
    return { items, hasMore, cacheHit, budgetRemaining, status, liveUsed, liveReason };
  }

  try {
    // OFFLINE-ONLY: Skip all live API calls. Go straight to cache/DB.
    console.log(`[AMAZON_FETCH] requestId=${requestId} OFFLINE-ONLY mode, checking cache/DB for "${query}"`);

    // 1. Check catalog_cache first
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
      console.log(`[AMAZON_FETCH] requestId=${requestId} CACHE hit: ${items.length} items`);
    } else {
      // 2. DB fallback from catalog_items
      const minPriceForDb = hasBuyingIntent && catalogFilters.minPrice ? catalogFilters.minPrice : undefined;
      const searchTokens = query.toLowerCase().split(/\s+/).filter((t: string) => t.length >= 2);
      let amazonQuery = supabase
        .from("catalog_items")
        .select("*", { count: "exact" })
        .in("provider", ["rainforest", "amazon"]);
      
      if (searchTokens.length > 0) {
        const topTokens = [...searchTokens].sort((a: string, b: string) => b.length - a.length).slice(0, 3);
        for (const token of topTokens) {
          amazonQuery = amazonQuery.ilike("title", `%${token}%`);
        }
      } else {
        amazonQuery = amazonQuery.ilike("title", `%${query}%`);
      }

      if (minPriceForDb) amazonQuery = amazonQuery.gte("price_usd", minPriceForDb);

      if (categoryKey) {
        const parentCategory = categoryKey.split("_")[0];
        amazonQuery = amazonQuery.or(`unified_category.eq.${parentCategory},unified_category.is.null,unified_category.eq.uncategorized`);
      }

      const { data: amazonData, count } = await amazonQuery
        .order("rating", { ascending: false, nullsFirst: false })
        .range(mixerCursor.amazonReturnedSoFar, mixerCursor.amazonReturnedSoFar + limit - 1);

      if (amazonData && amazonData.length > 0) {
        items = amazonData.map(item => {
          const mapped = mapDbItemToResponse(item as Record<string, unknown>);
          if (categoryKey) mapped.category = categoryKey;
          return mapped;
        });
        hasMore = (count || 0) > mixerCursor.amazonReturnedSoFar + amazonData.length;
        cacheHit = true;
        status = "cached";
        console.log(`[AMAZON_FETCH] requestId=${requestId} DB returned ${items.length} items`);
      }
    }

    // 3. If zero results, enqueue for background ingestion
    if (items.length === 0 && query.length >= 3) {
      console.log(`[AMAZON_FETCH] requestId=${requestId} cache miss for "${query}", enqueuing for ingest`);
      supabase.from("amazon_ingest_queue")
        .upsert({
          query: query.toLowerCase().trim(),
          category_key: categoryKey || null,
          reason: "cache_miss",
          priority: 5,
          status: "queued",
          updated_at: new Date().toISOString(),
        }, { onConflict: "query", ignoreDuplicates: true })
        .then(() => {});
    }
  } catch (err) {
    console.error(`[AMAZON_FETCH] requestId=${requestId} error:`, err);
    status = "error";
  }

  return { items, hasMore, cacheHit, budgetRemaining, status, liveUsed, liveReason };
}
