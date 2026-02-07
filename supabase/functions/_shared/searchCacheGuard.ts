/**
 * Search Cache Guard — validates cached payloads against current request parameters
 * and handles stale-while-revalidate / negative-cache logic.
 */

import { VEHICLE_TOY_ACCESSORY_FILTER_KEYWORDS } from "./vehicleDetection.ts";
import { postFilterItems } from "./sortFilterNormalizer.ts";

export interface CacheGuardParams {
  cacheResult: any;
  qNorm: string;
  hasBuyingIntent: boolean;
  catalogFilters: any;
  requestId: string;
}

/**
 * Validate cache hit against current request.
 * Returns updated cacheResult (possibly forced to miss).
 */
export function validateCacheHit(params: CacheGuardParams): any {
  let { cacheResult, qNorm, hasBuyingIntent, catalogFilters, requestId } = params;
  const currentMinPriceUsed = hasBuyingIntent ? (catalogFilters.minPrice || 1000) : 0;

  // _meta mismatch detection
  if (cacheResult.hit && cacheResult.data?._meta) {
    const cachedMeta = cacheResult.data._meta;
    const qMismatch = cachedMeta.qNorm && cachedMeta.qNorm !== qNorm;
    const vmMismatch = cachedMeta.vehicleMode !== undefined && cachedMeta.vehicleMode !== hasBuyingIntent;
    const mpMismatch = cachedMeta.minPriceUsed !== undefined && cachedMeta.minPriceUsed !== currentMinPriceUsed;

    if (qMismatch || vmMismatch || mpMismatch) {
      console.warn(JSON.stringify({
        event: "[CATALOG_SEARCH] cache_mismatch",
        cache_key: cacheResult.cacheKey?.substring(0, 80),
        cachedQ: cachedMeta.qNorm, currentQ: qNorm,
        cachedVM: cachedMeta.vehicleMode, currentVM: hasBuyingIntent,
        cachedMP: cachedMeta.minPriceUsed, currentMP: currentMinPriceUsed,
        action: "forcing_miss", requestId,
      }));
      cacheResult = { ...cacheResult, hit: false, stale: true };
    }
  }

  // Legacy vm=1 fallback
  if (cacheResult.hit && hasBuyingIntent) {
    if (!cacheResult.cacheKey?.includes("vm=1")) {
      console.warn(`[CATALOG_SEARCH] requestId=${requestId} CACHE_MISMATCH: vehicleMode=true but cache key lacks vm=1. Forcing miss.`);
      cacheResult = { ...cacheResult, hit: false, stale: true };
    }
  }

  // Empty cache guard
  if (cacheResult.hit && !cacheResult.stale && !cacheResult.negativeCached) {
    if ((cacheResult.data?.items?.length ?? 0) === 0) {
      console.log(`[CATALOG_SEARCH] requestId=${requestId} empty_cache_guard: cached payload has 0 items, treating as miss`);
      cacheResult = { ...cacheResult, hit: false, stale: false };
    }
  }

  return cacheResult;
}

/**
 * Apply vehicle safety filters + post-filters to cached items.
 */
export function filterCachedItems(
  items: any[],
  hasBuyingIntent: boolean,
  catalogFilters: any,
  requestId: string,
): any[] {
  let result = items;

  // Post-filter by price/brand/rating
  const hasFilters = catalogFilters.minPrice !== undefined ||
    catalogFilters.maxPrice !== undefined ||
    catalogFilters.brand !== undefined ||
    catalogFilters.rating !== undefined;
  if (hasFilters && result.length > 0) {
    const before = result.length;
    result = postFilterItems(result, catalogFilters);
    console.log(`[CATALOG_SEARCH] requestId=${requestId} cache_postfilter: ${before} → ${result.length}`);
  }

  // Vehicle safety filters
  if (hasBuyingIntent && result.length > 0) {
    const before1 = result.length;
    result = result.filter((item: any) => {
      const price = item.priceUsd ?? item.price_usd ?? 0;
      return price >= 1000;
    });
    if (before1 !== result.length) {
      console.log(`[CATALOG_SEARCH] requestId=${requestId} vehicle_cache_filter: ${before1} → ${result.length}`);
    }

    const before2 = result.length;
    result = result.filter((item: any) => {
      const title = (item.title || "").toLowerCase();
      return !VEHICLE_TOY_ACCESSORY_FILTER_KEYWORDS.some(kw => title.includes(kw));
    });
    if (before2 !== result.length) {
      console.log(JSON.stringify({
        event: "[CATALOG_SEARCH] vehicle_post_filter",
        before: before2, after: result.length, minPriceUsed: 1000, requestId,
      }));
    }
  }

  return result;
}
