

# URGENT BUGFIX: Cache Key/Payload Mismatch Protection (v4)

## Problem Summary

Searches like "range rover" sometimes return completely unrelated results (phones, accessories) due to **cache key/payload mismatch**. This happens when:

1. A query is cached with `vehicleMode=false` (returning accessories)
2. Later, with updated vehicle detection logic, the same query now triggers `vehicleMode=true`
3. But the cache key still matches an old entry with wrong results (poisoned cache)

**Evidence:** The cache contains entries like:
```
cache_key: search:v3:q=range rover:...:vm=0:mp=0:...
```
When it SHOULD have been stored with `vm=1:mp=1000`.

---

## Solution: Cache Version Bump + Payload Signature Validation

### 1. Bump Cache Version from v3 to v4

**File: `supabase/functions/_shared/catalogCache.ts`**

Change the cache version constant to invalidate all existing search cache entries:

```typescript
// Line 13
export const AMAZON_CACHE_VERSION = "v4"; // v4: Added _meta payload signature for mismatch detection
```

This ensures:
- All existing `search:v3:...` keys are automatically missed
- Fresh fetches with correct vehicle detection

---

### 2. Add `_meta` Signature to Cache Payload

**File: `supabase/functions/_shared/catalogCache.ts`**

Update `normalizeCachePayload()` to accept and embed metadata for mismatch detection:

```typescript
// Update function signature (around line 320)
export function normalizeCachePayload(
  type: CacheType, 
  data: any, 
  pageSize: number = 20,
  meta?: {
    qNorm?: string;
    provider?: string;
    page?: number;
    pageSize?: number;
    sort?: string;
    category_key?: string;
    vehicleMode?: boolean;
    minPriceUsed?: number;
  }
): any {
  switch (type) {
    case "search":
      return {
        items: Array.isArray(data.items)
          ? data.items.slice(0, pageSize).map(normalizeCatalogItem)
          : [],
        total: data.total ?? null,
        usedVariantCount: data.usedVariantCount || 1,
        // NEW: Embed query signature for mismatch detection on read
        _meta: meta ? {
          qNorm: meta.qNorm,
          provider: meta.provider,
          page: meta.page,
          pageSize: meta.pageSize,
          sort: meta.sort,
          category_key: meta.category_key,
          vehicleMode: meta.vehicleMode,
          minPriceUsed: meta.minPriceUsed,
          cachedAt: new Date().toISOString(),
        } : undefined,
      };
    // ... other cases unchanged
  }
}
```

---

### 3. Update Cache Write to Include `_meta`

**File: `supabase/functions/catalog-search/index.ts`**

Update the cache write section (around line 1556) to pass metadata:

```typescript
// Build _meta signature for cache validation
const cacheMeta = {
  qNorm,
  provider: providerParam || "mixed",
  page: Math.floor(mixerCursor.ebayOffset / limit) + 1,
  pageSize: limit,
  sort,
  category_key: categoryKey || undefined,
  vehicleMode: hasBuyingIntent,
  minPriceUsed: hasBuyingIntent ? (catalogFilters.minPrice || 1000) : 0,
};

// Store for instant retrieval with embedded signature
if (finalItems.length > 0) {
  setCache(supabase, "search", globalCacheKey, 
    { ...response, _meta: cacheMeta }, // Embed meta in response
    {
      provider: "mixed",
      query: qNorm,
      category: categoryKey || undefined,
      page: cacheMeta.page,
      pageSize: limit,
      amazonDomain: "amazon.com",
    }
  ).catch(err => console.warn(`[CATALOG_SEARCH] requestId=${requestId} Cache write failed:`, err));
  
  console.log(JSON.stringify({
    event: "[CATALOG_SEARCH] cache_write",
    cache_key: globalCacheKey.substring(0, 80),
    qNorm,
    vehicleMode: hasBuyingIntent,
    minPriceUsed: cacheMeta.minPriceUsed,
    requestId,
  }));
}
```

---

### 4. Add Cache Mismatch Detection on Read

**File: `supabase/functions/catalog-search/index.ts`**

Expand the existing cache mismatch detection (around line 1218-1229) to validate `_meta` signature:

```typescript
// ═══════════════════════════════════════════════════════════════════════════
// CACHE MISMATCH DETECTION (v4 POISON FIX):
// Validate cached payload._meta matches current request parameters
// Force cache miss if any critical parameter differs (prevents cache poisoning)
// ═══════════════════════════════════════════════════════════════════════════
if (cacheResult.hit && cacheResult.data?._meta) {
  const cachedMeta = cacheResult.data._meta;
  const currentMeta = {
    qNorm,
    vehicleMode: hasBuyingIntent,
    minPriceUsed: hasBuyingIntent ? (catalogFilters.minPrice || 1000) : 0,
  };
  
  // Check for critical mismatches
  const qMismatch = cachedMeta.qNorm && cachedMeta.qNorm !== currentMeta.qNorm;
  const vmMismatch = cachedMeta.vehicleMode !== undefined && cachedMeta.vehicleMode !== currentMeta.vehicleMode;
  const mpMismatch = cachedMeta.minPriceUsed !== undefined && cachedMeta.minPriceUsed !== currentMeta.minPriceUsed;
  
  if (qMismatch || vmMismatch || mpMismatch) {
    console.warn(JSON.stringify({
      event: "[CATALOG_SEARCH] cache_mismatch",
      cache_key: cacheResult.cacheKey.substring(0, 80),
      cachedQ: cachedMeta.qNorm,
      currentQ: currentMeta.qNorm,
      cachedVM: cachedMeta.vehicleMode,
      currentVM: currentMeta.vehicleMode,
      cachedMP: cachedMeta.minPriceUsed,
      currentMP: currentMeta.minPriceUsed,
      action: "forcing_miss",
      requestId,
    }));
    cacheResult = { ...cacheResult, hit: false, stale: true };
  }
}

// Keep existing vm=1 fallback check for legacy entries without _meta
if (cacheResult.hit && hasBuyingIntent) {
  const cacheKeyHasVehicleMode = cacheResult.cacheKey.includes("vm=1");
  if (!cacheKeyHasVehicleMode) {
    console.warn(`[CATALOG_SEARCH] requestId=${requestId} CACHE_MISMATCH: vehicleMode=true but cache key lacks vm=1. Forcing miss.`);
    cacheResult = { ...cacheResult, hit: false, stale: true };
  }
}
```

---

### 5. Add Cache Hit Logging

**File: `supabase/functions/catalog-search/index.ts`**

Update the fresh cache hit log (around line 1233) to include qNorm:

```typescript
if (cacheResult.hit && !cacheResult.stale && !cacheResult.negativeCached) {
  console.log(JSON.stringify({
    event: "[CATALOG_SEARCH] cache_hit",
    cache_key: globalCacheKey.substring(0, 80),
    qNorm,
    vehicleMode: hasBuyingIntent,
    cacheAgeSec: cacheResult.cacheAgeSec,
    requestId,
  }));
  // ... rest of cache hit handling
}
```

---

### 6. Purge All v3 Search Cache Entries

Execute SQL migration to remove all old `search:v3:` entries:

```sql
-- Purge v3 search cache entries (now using v4)
DELETE FROM public.catalog_cache 
WHERE cache_type = 'search' 
  AND cache_key LIKE 'search:v3:%';

-- Also purge any legacy v2 entries that might still exist
DELETE FROM public.catalog_cache 
WHERE cache_type = 'search' 
  AND cache_key LIKE 'search:v2:%';
```

---

## Files to Modify

| File | Changes |
|------|---------|
| `supabase/functions/_shared/catalogCache.ts` | Bump version to v4, add `_meta` to payload normalization |
| `supabase/functions/catalog-search/index.ts` | Add `_meta` validation on cache read, enhanced logging on cache hit/write |
| Database | Purge v2 and v3 search cache entries |

---

## Expected Behavior After Fix

### Cache Write
```json
{"event":"[CATALOG_SEARCH] cache_write","cache_key":"search:v4:q=range rover:...","qNorm":"range rover","vehicleMode":true,"minPriceUsed":1000}
```

### Cache Hit (Valid)
```json
{"event":"[CATALOG_SEARCH] cache_hit","cache_key":"search:v4:q=range rover:...","qNorm":"range rover","vehicleMode":true,"cacheAgeSec":42}
```

### Cache Mismatch (Forced Miss)
```json
{"event":"[CATALOG_SEARCH] cache_mismatch","cachedQ":"range rover","currentQ":"range rover","cachedVM":false,"currentVM":true,"action":"forcing_miss"}
```

---

## Technical Summary

| Component | Change |
|-----------|--------|
| Cache Version | v3 → v4 |
| Cache Key | Already includes `vm=` and `mp=` markers |
| Cache Payload | NEW: `_meta` object with qNorm, vehicleMode, minPriceUsed |
| Cache Read | NEW: Validate `_meta` matches current request before returning |
| Cache Write | NEW: Embed `_meta` in payload for future validation |
| Logging | Enhanced structured JSON logs for cache_hit, cache_mismatch, cache_write |

This **defense-in-depth** approach ensures:
1. **Version bump** → Immediate invalidation of all potentially poisoned entries
2. **Payload signature** → Runtime detection of any future mismatches
3. **Logging** → Full visibility for debugging cache behavior

