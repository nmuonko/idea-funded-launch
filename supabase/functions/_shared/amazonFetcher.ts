/**
 * Amazon Fetcher - Shared Amazon/Rainforest search logic
 * Used by catalog-search and catalog-category
 */

// Use 'any' type to avoid importing the Supabase SDK (prevents bundle bloat)
type SupabaseClientAny = any;

import { searchRainforest } from "./rainforestAdapter.ts";
import { mapCategoryAndSubcategory } from "./categoryMapper.ts";
import { CatalogSettings } from "./catalogSettings.ts";
import { checkBudget, incrementBudget, AmazonStatusInfo } from "./providerBudget.ts";
import { MixerCursor } from "./providerMixer.ts";
import { 
  getAmazonLiveSettings, 
  shouldUseAmazonLive, 
  buildAmazonCacheKey,
  AmazonLiveReason,
} from "./amazonLivePolicy.ts";
import { CatalogFilters } from "./sortFilterNormalizer.ts";
import { 
  CatalogItem, 
  mapDbItemToResponse, 
  mapRainforestProduct 
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
  let budgetRemaining: number | null = null;
  let status: AmazonStatusInfo["status"] = "disabled";
  let liveUsed = false;
  let liveReason: AmazonLiveReason = "disabled";

  if (!effectiveMode.amazonActive || effectiveMode.mode === "ebay") {
    return { items, hasMore, cacheHit, budgetRemaining, status, liveUsed, liveReason };
  }

  try {
    const budgetStatus = await checkBudget(
      supabase, "amazon", settings.amazonBudgetWindow, settings.amazonMaxCallsPerHour, requestId
    );
    budgetRemaining = budgetStatus.remaining;

    const liveSettings = await getAmazonLiveSettings(supabase);
    const queryCapHit = mixerCursor.amazonReturnedSoFar >= settings.amazonMaxResultsPerQuery;

    if (queryCapHit) {
      status = "cap_exhausted";
      liveReason = "cache_only";
      console.log(`[AMAZON_FETCH] requestId=${requestId} cap exhausted: ${mixerCursor.amazonReturnedSoFar}/${settings.amazonMaxResultsPerQuery}`);
    } else {
      const liveDecision = shouldUseAmazonLive({
        endpoint: "search", query, amazonPage: mixerCursor.amazonPage,
        amazonEnabled: effectiveMode.amazonActive, budgetAllowed: budgetStatus.allowed,
        budgetRemaining: budgetStatus.remaining, liveSettings, requestId,
      });

      liveReason = liveDecision.reason;

      if (liveDecision.useLive) {
        // DON'T force Autos category for heavy equipment (tractor, excavator, etc.)
        const vehicleCategoryId = (isVehicle && !isHeavyEquipment) ? AMAZON_AUTOS_CATEGORY_ID : undefined;
        const minPriceFilter = hasBuyingIntent && catalogFilters.minPrice ? catalogFilters.minPrice : undefined;
        
        console.log(`[AMAZON_FETCH] requestId=${requestId} LIVE search: "${query}" page=${mixerCursor.amazonPage}${vehicleCategoryId ? ` category=${vehicleCategoryId}` : ""}${minPriceFilter ? ` minPrice=${minPriceFilter}` : ""}`);
        
        const liveResult = await searchRainforest(query, mixerCursor.amazonPage, limit, "amazon.com", "relevance", { minPrice: minPriceFilter }, vehicleCategoryId);
        
        if (!liveResult.error && liveResult.products.length > 0) {
          liveUsed = true;
          status = "live";

          await incrementBudget(supabase, "amazon", settings.amazonBudgetWindow, requestId);
          budgetRemaining = Math.max(0, (budgetRemaining || 0) - 1);

          items = liveResult.products.map(p => mapRainforestProduct(p, categoryKey));
          hasMore = liveResult.hasMore;

          // Cache live results (async)
          const cacheKey = buildAmazonCacheKey({ query, categoryKey, page: mixerCursor.amazonPage });
          const now = new Date();
          const cacheTtlSeconds = settings.searchCacheTtlSeconds || 172800;
          const expiresAt = new Date(now.getTime() + cacheTtlSeconds * 1000);
          const staleAt = new Date(now.getTime() + (cacheTtlSeconds / 2) * 1000);

          supabase.from("catalog_cache").upsert({
            cache_key: cacheKey, cache_type: "search_amazon", provider: "rainforest",
            query, category: categoryKey, page: mixerCursor.amazonPage,
            response: { products: liveResult.products, total: liveResult.total, hasMore: liveResult.hasMore },
            expires_at: expiresAt.toISOString(), stale_at: staleAt.toISOString(), updated_at: now.toISOString(),
          }, { onConflict: "cache_key" });

          // Upsert catalog_items (async)
          const toUpsert = liveResult.products.map(p => {
            const { category: mappedCat, subcategory } = mapCategoryAndSubcategory({
              title: p.title || "", provider: "rainforest", productUrl: p.productUrl || "",
            });
            return {
              id: `amazon_${p.providerProductId}`, provider: "rainforest",
              provider_product_id: p.providerProductId, title: p.title,
              price_usd: p.priceUsd, image_url: p.imageUrl,
              images: (p.images?.length > 0) ? p.images : (p.imageUrl ? [p.imageUrl] : []),
              product_url: p.productUrl, in_stock: p.inStock ?? true, rating: p.rating,
              unified_category: mappedCat !== "blocked" ? mappedCat : (categoryKey?.split("_")[0] || "electronics"),
              unified_subcategory: subcategory, updated_at: now.toISOString(),
            };
          });
          supabase.from("catalog_items").upsert(toUpsert, { onConflict: "id" });

          console.log(`[AMAZON_FETCH] requestId=${requestId} LIVE returned ${items.length} items`);
        }
      }

      // Fallback to cache/DB
      if (items.length === 0) {
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
          // DB fallback
          const minPriceForDb = hasBuyingIntent && catalogFilters.minPrice ? catalogFilters.minPrice : undefined;

          // Build token-level search for better recall
          const searchTokens = query.toLowerCase().split(/\s+/).filter((t: string) => t.length >= 2);
          let amazonQuery = supabase
            .from("catalog_items")
            .select("*", { count: "exact" })
            .in("provider", ["rainforest", "amazon"]);
          
          // Apply token-level ilike filters (ANDed) for better matching
          if (searchTokens.length > 0) {
            // Use the 3 longest tokens for matching (most distinctive)
            const topTokens = [...searchTokens].sort((a: string, b: string) => b.length - a.length).slice(0, 3);
            for (const token of topTokens) {
              amazonQuery = amazonQuery.ilike("title", `%${token}%`);
            }
          } else {
            amazonQuery = amazonQuery.ilike("title", `%${query}%`);
          }
          
          // For vehicle queries without buying intent, also include automotive category
          if (isVehicle && !hasBuyingIntent) {
            // Already covered by token matching above
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
      }
    }
  } catch (err) {
    console.error(`[AMAZON_FETCH] requestId=${requestId} error:`, err);
    status = "error";
  }

  return { items, hasMore, cacheHit, budgetRemaining, status, liveUsed, liveReason };
}
