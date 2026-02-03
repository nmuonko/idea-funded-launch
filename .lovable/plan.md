
# Fix Price USD Filter: Include Filters in Cache Key + Pass to Providers

## Problem

When applying the Price USD filter (e.g., min=0, max=$150), search results still show items over $150. This is caused by three interconnected issues:

1. **Cache key ignores filters**: Different filter combinations return the same cached results
2. **eBay search doesn't receive filters**: The `catalogFilters` object is not passed to the eBay API call
3. **Cached responses bypass post-filter**: When returning cached data, the post-filter step is skipped

---

## Solution Overview

```text
Current Flow (Broken):
User searches "iphone" (maxPrice=150)
  → Cache key: "search:iphone:all:page1" (no filters!)
  → Returns cached results from unfiltered search
  → Items over $150 appear ❌

Fixed Flow:
User searches "iphone" (maxPrice=150)
  → Cache key: "search:iphone:all:page1:maxPrice=150" 
  → Cache miss (first request with this filter)
  → eBay API called with price:[0..150] filter
  → Results saved to cache WITH filter info
  → Post-filter applied as backup
  → Only items ≤$150 appear ✓
```

---

## Technical Changes

### 1. Include Filters in Cache Key

**File:** `supabase/functions/catalog-search/index.ts` (lines 462-469)

Add filter parameters to the cache key so different filter combinations have separate cached results:

```typescript
const globalCacheKey = buildCacheKey("search", {
  env: envName,
  query: qNorm,
  provider: providerParam || "all",
  category: categoryKey || undefined,
  page: Math.floor(mixerCursor.ebayOffset / limit) + 1,
  pageSize: limit,
  // NEW: Include filters in cache key
  minPrice: catalogFilters.minPrice,
  maxPrice: catalogFilters.maxPrice,
  brand: catalogFilters.brand?.join(","),
  rating: catalogFilters.rating,
  condition: catalogFilters.condition,
});
```

### 2. Pass Filters to eBay API Call

**File:** `supabase/functions/catalog-search/index.ts` (lines 780-792)

Add the `filters` parameter to the eBay search call so price filtering happens at the API level:

```typescript
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
    // NEW: Pass filters to eBay for API-level filtering
    filters: catalogFilters,
  },
  requestId
);
```

### 3. Apply Post-Filter to Cached Results

**File:** `supabase/functions/catalog-search/index.ts` (lines 474-492)

Apply filters to cached responses as a safety net:

```typescript
if (cacheResult.hit && !cacheResult.stale && !cacheResult.negativeCached) {
  console.log(`[SEARCH] requestId=${requestId} GLOBAL CACHE HIT`);
  
  const cachedResponse = cacheResult.data;
  
  // Apply post-filter to cached results (in case filters differ)
  let cachedItems = cachedResponse.items || [];
  const hasFilters = catalogFilters.minPrice !== undefined || 
                     catalogFilters.maxPrice !== undefined;
  if (hasFilters && cachedItems.length > 0) {
    cachedItems = postFilterItems(cachedItems, catalogFilters);
    console.log(`[SEARCH] requestId=${requestId} Cache post-filter: ${cachedResponse.items.length} → ${cachedItems.length}`);
  }
  
  return new Response(JSON.stringify({
    ...cachedResponse,
    items: cachedItems, // Use filtered items
    total: cachedItems.length,
    query: qOriginal,
    env: envName,
    durationMs: Date.now() - startTime,
    _cacheHit: true,
    _cacheAgeSec: cacheResult.cacheAgeSec,
  }), { ... });
}
```

---

## Files to Modify

| File | Changes |
|------|---------|
| `supabase/functions/catalog-search/index.ts` | Include filters in cache key, pass filters to eBay, post-filter cached results |

---

## Expected Results

### Before (Broken)
- Search "iphone" with maxPrice=$150 → Shows items at $800, $1200, etc.
- Same cached results regardless of filter

### After (Fixed)
- Search "iphone" with maxPrice=$150 → Only shows items ≤$150
- Each filter combination has its own cache entry
- eBay API returns pre-filtered results (faster)
- Post-filter catches any edge cases

---

## Testing Checklist

After implementation, verify:

1. Search "iphone" with no filters → Mix of prices
2. Search "iphone" with maxPrice=150 → All items ≤$150
3. Search "iphone" with minPrice=500, maxPrice=1000 → Only items in that range
4. Repeat search with same filter → Cache hit, still filtered correctly
5. Change filter → Cache miss, new filtered results
