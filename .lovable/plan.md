
# Plan: Fix Catalog-Home API Timeout Issue

## Problem Analysis

The mobile app is experiencing 20-second timeout errors when calling the `catalog-home` API endpoint. Based on the edge function logs:

```
duration=46501ms (over 46 seconds!)
checked=144 cacheHit=0 fetched=132
```

### Root Cause
The `catalog-home` endpoint performs **synchronous media enrichment** for all items before returning a response. When the media cache is cold (0 cache hits):

1. **8 sections × 18 items = 144 items** need media count lookups
2. Each uncached item triggers a `fetchAndCacheMedia()` call to `/catalog-product`
3. Even with concurrency of 4, fetching 132 items serially blocks the response
4. Total time: **46+ seconds** (far exceeding the 20-second client timeout)

### Architecture Flow

```text
┌────────────────────────────────────────────────────────────────────┐
│                         catalog-home                               │
├────────────────────────────────────────────────────────────────────┤
│  1. Load sections from DB                             ~10ms        │
│  2. Batch fetch cached sections                       ~50ms        │
│  3. For each section:                                              │
│     └─ enrichItemsWithMediaCounts() ◀── BLOCKING!                  │
│        └─ For each uncached item:                                  │
│           └─ fetchAndCacheMedia() → catalog-product  ~800ms each   │
│  4. Return response                                                │
└────────────────────────────────────────────────────────────────────┘

Timeline with cold cache:
├─ Sections loaded ─┼── Media enrichment (blocking) ──┼─ Response ─┤
        ~60ms                   45,000ms+                   ~1ms
```

## Solution

### Strategy: Non-Blocking Media Enrichment

Instead of waiting for all media to be fetched before responding, we will:

1. **Return cached counts immediately** - Use whatever is in the media cache
2. **Return fallback counts** for uncached items (imageCount from the item itself, or 1)
3. **Skip synchronous fetching entirely** - Let the existing prewarm job handle populating the cache
4. **Add a background queue mechanism** (optional enhancement) to trigger async prefetch

This approach follows the "fail-safe" pattern already documented in the project's memory:
> "All catalog endpoints must always return HTTP 200 with status: 'success', even during provider failures"

### Changes Required

#### File: `supabase/functions/_shared/mediaCache.ts`

Modify `enrichItemsWithMediaCounts()` to be cache-only (no live fetching):

1. Add a new parameter `skipPrefetch: boolean` (default: `true` for catalog-home)
2. When `skipPrefetch=true`:
   - Do batch cache lookup only
   - Return fallback counts for uncached items immediately
   - Skip the entire prefetch queue processing
3. Log stats for monitoring

```typescript
// Line ~344 - Update function signature
export async function enrichItemsWithMediaCounts<T extends Record<string, unknown>>(
  supabase: SupabaseClient,
  items: T[],
  settings?: MediaCacheSettings,
  options?: { skipPrefetch?: boolean }  // NEW
): Promise<{ items: T[]; stats: MediaEnrichmentStats }>

// Line ~420 - Replace prefetch logic with early return when skipPrefetch=true
if (options?.skipPrefetch || !config.prefetchEnabled) {
  // No prefetching - use fallback counts for all uncached items
  for (const entry of validItems) {
    const cachedCount = cachedCounts.get(entry.compositeId);
    if (cachedCount !== undefined && cachedCount > 0) {
      stats.cacheHit++;
      (enrichedItems[entry.index] as Record<string, unknown>).image_count = cachedCount;
      (enrichedItems[entry.index] as Record<string, unknown>).imageCount = cachedCount;
      (enrichedItems[entry.index] as Record<string, unknown>).image_count_status = "cached";
    } else {
      // Use fallback - don't block on fetch
      const item = enrichedItems[entry.index];
      const fallbackCount = (item.image_count as number) || (item.imageCount as number) || 1;
      (enrichedItems[entry.index] as Record<string, unknown>).image_count = fallbackCount;
      (enrichedItems[entry.index] as Record<string, unknown>).imageCount = fallbackCount;
      (enrichedItems[entry.index] as Record<string, unknown>).image_count_status = "pending";
    }
  }
  return { items: enrichedItems, stats };
}
```

#### File: `supabase/functions/catalog-home/index.ts`

Update the call to `enrichItemsWithMediaCounts()` to skip prefetch:

```typescript
// Line ~728-732
const { items: enrichedItems, stats: mediaStats } = await enrichItemsWithMediaCounts(
  supabase,
  slicedItems as unknown as Record<string, unknown>[],
  mediaCacheSettings,
  { skipPrefetch: true }  // NEW: Don't block on media fetches
);
```

## Expected Impact

| Metric | Before (Cold Cache) | After |
|--------|---------------------|-------|
| Response time | 46+ seconds | ~500ms |
| Cache misses | Blocking fetch | Return fallback |
| Image counts | Always accurate | Cached or fallback |
| User experience | Timeout errors | Fast loading |

### Trade-offs

| Aspect | Trade-off |
|--------|-----------|
| Image counts | May show fallback (1) until cache is warmed |
| Data freshness | Relies on prewarm job to populate cache |
| Complexity | Minimal - adds one parameter |

### Why This Works

1. **Existing prewarm jobs** already populate the media cache periodically
2. **Fallback of 1** is acceptable - users can see more images when they tap a product
3. **Mobile app won't crash** - fast response times prevent timeouts
4. **Progressive enhancement** - cache will fill over time, improving accuracy

## Files Modified

| File | Change |
|------|--------|
| `supabase/functions/_shared/mediaCache.ts` | Add `skipPrefetch` option to `enrichItemsWithMediaCounts()` |
| `supabase/functions/catalog-home/index.ts` | Pass `{ skipPrefetch: true }` when calling enrichment |

## Testing

1. Call `catalog-home` endpoint after clearing media cache
2. Verify response time is under 2 seconds
3. Confirm items have `image_count_status: "pending"` or `"cached"`
4. Verify no timeout errors in mobile app

## Future Enhancements (Out of Scope)

- Add async background job to pre-populate media cache for new items
- Add real-time cache warming when items are first displayed
- Consider client-side lazy-loading of accurate image counts
