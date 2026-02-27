/**
 * Search Cache Guard — validates cached payloads against current request parameters
 * and handles stale-while-revalidate / negative-cache logic.
 */


import { postFilterItems } from "./sortFilterNormalizer.ts";
import { scoreAndRankItems } from "./searchIntentScorer.ts";
import type { SearchIntent } from "./vehicleDetection.ts";

// Wrong-category keywords to drop from cached results (shoes in tech searches etc.)
const UNIVERSAL_WRONG_CAT_KW = [
  "shoes","sneakers","basketball shoes","running shoes","boots","sandals","slippers",
  "dress","pants","shorts","jeans","hoodie","jacket","shirt","t-shirt","polo",
  "jewelry","necklace","bracelet","earring","pendant",
  "poster","wall art","canvas","framed","artwork",
  "blanket","towel","pillow","curtain","rug",
];

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
 * Apply vehicle safety filters + post-filters + intent-based scoring to cached items.
 */
export function filterCachedItems(
  items: any[],
  hasBuyingIntent: boolean,
  catalogFilters: any,
  requestId: string,
  intentKey?: string,
  qNorm?: string,
): any[] {
  let result = items;

  // ── Intent-based scoring (including general) with real query tokens ──
  if (result.length > 0) {
    const resolvedIntentKey = intentKey || "general";
    const intent: SearchIntent = {
      intentKey: resolvedIntentKey,
      vehicleListingIntent: resolvedIntentKey === "vehicle_listing",
      vehiclePartsIntent: resolvedIntentKey === "vehicle_parts",
      phoneDeviceIntent: resolvedIntentKey === "phone_device",
      phoneAccessoryIntent: resolvedIntentKey === "phone_accessory",
      isHeavyEquipment: resolvedIntentKey === "heavy_equipment",
    };
    const queryTokens: string[] = (qNorm || "")
      .toLowerCase()
      .split(/\s+/)
      .filter((t) => t.length >= 2);

    const before = result.length;
    const scored = scoreAndRankItems(result, intent, queryTokens, result.length);
    result = scored.items;
    if (before !== result.length) {
      console.log(`[CATALOG_SEARCH] requestId=${requestId} cache_intent_filter(${resolvedIntentKey}): ${before} → ${result.length} (dropped=${scored.dropped})`);
    }
  }

  // ── Universal wrong-category drop (shoes/clothing in tech searches) ──
  if (intentKey && ["gaming", "phone_device", "phone_accessory"].includes(intentKey) && result.length > 0) {
    const before = result.length;
    result = result.filter((item: any) => {
      const title = ((item.title || "") as string).toLowerCase();
      return !UNIVERSAL_WRONG_CAT_KW.some(kw => title.includes(kw));
    });
    if (before !== result.length) {
      console.log(`[CATALOG_SEARCH] requestId=${requestId} cache_wrong_cat_filter: ${before} → ${result.length}`);
    }
  }

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

  }

  return result;
}
