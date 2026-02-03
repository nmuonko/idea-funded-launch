
# Fix Slow Initial Search: Parallelize Provider API Calls

## Problem Identified

Edge function logs show first search taking **6-11+ seconds** on cache miss:

```
[SEARCH_PERF] total_ms=11276, items_returned=0
[SEARCH_PERF] total_ms=7029, items_returned=0
[SEARCH_PERF] total_ms=6498, items_returned=0
```

The `rewrite_settings_ms` (~150ms) and `cache_check_ms` (~125ms) are fast, but the **provider calls are still sequential** in the code despite an earlier partial optimization.

---

## Root Cause

Looking at `catalog-search/index.ts`:

- **Lines 552-759**: Amazon fetch block (300-800ms for live API, 50-150ms for cache/DB)
- **Lines 761-863**: eBay fetch block (runs AFTER Amazon completes, 300-800ms)

These blocks run **sequentially**. When both providers need live API calls, total time = Amazon time + eBay time = 600-1600ms minimum just for API calls.

---

## Solution: Run Amazon + eBay in Parallel

Refactor the provider fetching to use `Promise.allSettled()` so both API calls happen concurrently:

```text
Current (Sequential):
Amazon fetch ──────────────> eBay fetch ─────────────>
[     ~500ms              ]  [     ~500ms             ]
                                                      Total: ~1000ms+

Optimized (Parallel):
Amazon fetch ──────────────>
eBay fetch ────────────────>
[       ~500ms            ]
                           Total: ~500ms (max of both)
```

---

## Technical Changes

### File: `supabase/functions/catalog-search/index.ts`

**1. Extract Amazon + eBay fetching into separate async functions:**

```typescript
// New helper function for Amazon fetching
async function fetchAmazonItems(params: {
  supabase: SupabaseClient;
  query: string;
  settings: CatalogSettings;
  effectiveMode: { amazonActive: boolean; mode: string };
  mixerCursor: MixerCursor;
  isVehicle: boolean;
  categoryKey: string | undefined;
  limit: number;
  requestId: string;
}): Promise<{
  items: CatalogItem[];
  hasMore: boolean;
  cacheHit: boolean;
  budgetRemaining: number | null;
  status: string;
  liveUsed: boolean;
  liveReason: string;
}> {
  // ... existing Amazon logic moved here
}

// New helper function for eBay fetching
async function fetchEbayItems(params: {
  supabase: SupabaseClient;
  query: string;
  effectiveMode: { ebayActive: boolean; mode: string };
  isVehicle: boolean;
  categoryKey: string | undefined;
  page: number;
  limit: number;
  catalogFilters: CatalogFilters;
  requestId: string;
}): Promise<{
  items: CatalogItem[];
  hasMore: boolean;
  total: number;
}> {
  // ... existing eBay logic moved here
}
```

**2. Call both providers in parallel using `Promise.allSettled`:**

```typescript
// ─── PARALLEL PROVIDER FETCH ──────────────────────────────────────────────
const providerStartMs = Date.now();

const [amazonResult, ebayResult] = await Promise.allSettled([
  // Amazon fetch (only if active)
  effectiveMode.amazonActive && effectiveMode.mode !== "ebay"
    ? fetchAmazonItems({ supabase, query: qNorm, settings, effectiveMode, mixerCursor, isVehicle, categoryKey, limit, requestId })
    : Promise.resolve({ items: [], hasMore: false, cacheHit: false, budgetRemaining: null, status: "disabled", liveUsed: false, liveReason: "disabled" }),
  
  // eBay fetch (only if active)
  effectiveMode.ebayActive && effectiveMode.mode !== "amazon"
    ? fetchEbayItems({ supabase, query: qNorm, effectiveMode, isVehicle, categoryKey, page, limit, catalogFilters, requestId })
    : Promise.resolve({ items: [], hasMore: false, total: 0 }),
]);

perfLog.provider_ms = Date.now() - providerStartMs;

// Process results safely (handle individual provider failures gracefully)
let amazonItems: CatalogItem[] = [];
let ebayItems: CatalogItem[] = [];
let amazonHasMore = false;
let ebayHasMore = false;
// ... extract from settled promises
```

**3. Add detailed performance logging:**

```typescript
console.log(`[SEARCH_PERF] requestId=${requestId}`, JSON.stringify({
  rewrite_settings_ms: perfLog.rewrite_ms,
  cache_check_ms: perfLog.cache_ms,
  provider_parallel_ms: perfLog.provider_ms,  // NEW: Track provider time
  amazon_status: amazonStatus,
  ebay_items: ebayItems.length,
  total_ms: durationMs,
  items_returned: finalItems.length,
  cache_hit: false,
}));
```

---

## Expected Performance Improvement

| Scenario | Before (Sequential) | After (Parallel) | Improvement |
|----------|---------------------|------------------|-------------|
| Both providers LIVE | ~1000-1600ms | ~500-800ms | **40-50% faster** |
| Amazon cache + eBay live | ~350-900ms | ~300-800ms | ~10% faster |
| Both providers cache/DB | ~100-300ms | ~75-150ms | ~50% faster |
| Total first search | 6-11+ seconds | 3-6 seconds | **~50% faster** |

---

## Files to Modify

| File | Changes |
|------|---------|
| `supabase/functions/catalog-search/index.ts` | Extract provider functions, parallelize with Promise.allSettled, add timing logs |

---

## Error Handling

Using `Promise.allSettled` (not `Promise.all`) ensures:
- If Amazon fails, eBay results still display
- If eBay fails, Amazon results still display
- Both failing = empty results with graceful error

```typescript
if (amazonResult.status === 'fulfilled') {
  amazonItems = amazonResult.value.items;
  // ... extract other values
} else {
  console.error(`[SEARCH] Amazon fetch failed:`, amazonResult.reason);
  amazonStatus = "error";
}

if (ebayResult.status === 'fulfilled') {
  ebayItems = ebayResult.value.items;
  // ... extract other values
} else {
  console.error(`[SEARCH] eBay fetch failed:`, ebayResult.reason);
}
```

---

## Testing Checklist

After implementation:

1. Search "iphone" (cold cache) - should return in ~3-4 seconds instead of 6-11
2. Check logs for `provider_parallel_ms` timing
3. Verify both Amazon and eBay results appear in mixed mode
4. Test with filters (maxPrice=150) - filtering still works
5. Test cache hit scenario - should be instant (<100ms)
