
# Cache Poisoning Fix for Vehicle Searches

## Problem Summary
Vehicle searches like "infiniti qx80" are returning accessories (phone cases, diecast models, floor mats) instead of actual vehicles because:
1. Old cache entries were created **before** the vehicle detection and `vehicleMode` fixes were implemented
2. These poisoned entries have cache keys using `search:v2` prefix that don't include `vehicleMode` flag
3. When the iOS app requests `pageSize=36`, it hits these old cached results

## Solution Overview

### 1. Cache Version Bump (v2 → v3)
Change the cache key prefix from `search:v2` to `search:v3` to ensure all old poisoned cache entries are never matched again.

**File: `supabase/functions/_shared/catalogCache.ts`**
```text
Line 13: export const AMAZON_CACHE_VERSION = "v2"; 
      →  export const AMAZON_CACHE_VERSION = "v3";
```

Also explicitly include `vehicleMode` and `minPriceUsed` as separate key components (not just inside filters JSON) for clarity:

```text
Lines 192-206: Update cache key format to:
search:v3:q=...:p=...:cat=...:pg=...:sz=...:vm={0|1}:mp={minPriceUsed}:f=...
```

### 2. One-Time Cache Purge Migration
Execute SQL to delete all v2 search cache entries across all relevant cache tables:

```sql
-- Purge all v2 search cache entries (poisoned)
DELETE FROM public.catalog_cache 
WHERE cache_type = 'search' AND cache_key LIKE 'search:v2:%';

-- Purge proxy cache if it exists
DELETE FROM public.search_proxy_cache 
WHERE cache_key LIKE 'search:v2:%';

-- Purge catalog_search_cache if it has v2 entries
DELETE FROM public.catalog_search_cache 
WHERE cache_key LIKE 'search:v2:%';
```

### 3. Defensive Cache-Hit Filtering
Add post-filter safety net in the cache hit return path to filter out obvious toys/accessories even if a poisoned entry is somehow hit:

**File: `supabase/functions/catalog-search/index.ts`**

Add after line 1107 (where cached items are processed):
```typescript
// VEHICLE CACHE POISONING FIX: Always enforce minPrice for vehicle searches
// This catches any old cache entries that don't have proper vehicle filtering
if (hasBuyingIntent && cachedItems.length > 0) {
  const beforeVehicleFilter = cachedItems.length;
  cachedItems = cachedItems.filter((item: any) => {
    const price = item.priceUsd ?? item.price_usd ?? 0;
    return price >= 1000;
  });
  if (beforeVehicleFilter !== cachedItems.length) {
    console.log(`[CATALOG_SEARCH] requestId=${requestId} vehicle_cache_filter: ${beforeVehicleFilter} → ${cachedItems.length} (enforced minPrice=1000)`);
  }
}

// ACCESSORY KEYWORD FILTER: Remove obvious toy/accessory results from vehicle cache
const ACCESSORY_TITLE_KEYWORDS = [
  'matchbox', 'diecast', '1:64', '1:43', '1:24', '1:18', 'hot wheels',
  'floor mat', 'key fob', 'fob cover', 'key cover', 'remote cover',
  'phone case', 'phone holder', 'car mount', 'decal', 'sticker',
  'poster', 'wall art', 'canvas', 'model car', 'toy car'
];
if (hasBuyingIntent && cachedItems.length > 0) {
  const beforeAccessoryFilter = cachedItems.length;
  cachedItems = cachedItems.filter((item: any) => {
    const title = (item.title || '').toLowerCase();
    return !ACCESSORY_TITLE_KEYWORDS.some(kw => title.includes(kw));
  });
  if (beforeAccessoryFilter !== cachedItems.length) {
    console.log(`[CATALOG_SEARCH] requestId=${requestId} accessory_title_filter: ${beforeAccessoryFilter} → ${cachedItems.length}`);
  }
}
```

### 4. Cache Key Mismatch Detection
Force cache miss if vehicle intent is detected but cache key lacks `vehicleMode` marker:

**File: `supabase/functions/catalog-search/index.ts`**

Add before line 1099 (cache hit check):
```typescript
// CACHE MISMATCH DETECTION: Force miss if vehicleMode not in cache key
if (cacheResult.hit && hasBuyingIntent) {
  const cacheKeyHasVehicleMode = cacheResult.cacheKey.includes('vm=1') || 
                                  cacheResult.cacheKey.includes('vehicleMode');
  if (!cacheKeyHasVehicleMode) {
    console.warn(`[CATALOG_SEARCH] requestId=${requestId} CACHE_MISMATCH: vehicleMode=true but cache key lacks vm=1. Forcing miss.`);
    cacheResult.hit = false;
    cacheResult.stale = true;
  }
}
```

## Files to Modify

| File | Changes |
|------|---------|
| `supabase/functions/_shared/catalogCache.ts` | Bump `AMAZON_CACHE_VERSION` to "v3", add explicit `vm` and `mp` to cache key format |
| `supabase/functions/catalog-search/index.ts` | Add defensive post-filtering for vehicle cache hits, cache mismatch detection |
| Database | Execute purge migration for v2 entries |

## Technical Details

### Updated Cache Key Format (v3)
```
search:v3:q={canonicalizedQuery}:p={provider}:cat={category}:pg={page}:sz={pageSize}:vm={0|1}:mp={minPriceUsed}:f={filtersJSON}
```

Example for "infiniti qx80" with vehicle mode:
```
search:v3:q=infiniti qx80:p=all:cat=:pg=1:sz=36:vm=1:mp=1000:f={"minPrice":1000,"vehicleMode":true}
```

### Accessory Keywords Blocklist for Title Filtering
- Toy/diecast: `matchbox`, `diecast`, `1:64`, `1:43`, `1:24`, `1:18`, `hot wheels`, `model car`, `toy car`
- Vehicle accessories: `floor mat`, `key fob`, `fob cover`, `key cover`, `remote cover`
- Phone accessories: `phone case`, `phone holder`, `car mount`
- Decorative: `decal`, `sticker`, `poster`, `wall art`, `canvas`

## Expected Behavior After Fix

| Query | vehicleMode | minPrice Enforced | Expected Results |
|-------|-------------|-------------------|------------------|
| "infiniti qx80" | true | $1,000 | Actual vehicles ($11k+) |
| "infiniti qx80 floor mats" | false | none | Floor mat accessories |
| "toyota camry for sale" | true | $1,000 | Actual vehicles |
| "infiniti" (brand only) | false | none | Mixed results |

## Logging Added
```
[CATALOG_SEARCH] vehicle_cache_filter: {before} → {after} (enforced minPrice=1000)
[CATALOG_SEARCH] accessory_title_filter: {before} → {after}
[CATALOG_SEARCH] CACHE_MISMATCH: vehicleMode=true but cache key lacks vm=1. Forcing miss.
```
