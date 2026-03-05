

## Fix: Category Products Show Only 200 + Load More Auto-Fires

### Root Cause

1. **Backend `total` is unreliable**: `catalog-category` returns `total = Math.max(ebayTotal, amazonItems.length, finalItems.length)` — when eBay returns 200 items and Amazon has 200 cached, `total` = 200. The frontend's background auto-fetcher sees `products.length >= total` and stops. Your DB actually has 41K phones, 92K clothing, 4.6K vehicles.

2. **Background auto-fetch runs unwanted**: The current code auto-fetches all pages silently, which causes the "Load More auto-clicks itself" behavior — `setCategoryLoadingMore(true)` triggers spinner on the button while background fetches run.

3. **`CategoryResultsPage.tsx`** has the same issue — its background loop fetches continuously and appends products, making the "Load More" button appear to auto-fire.

### Plan

#### 1. Fix backend `total` — return actual DB count for the category
In `catalog-category/index.ts`, add a separate count query against `catalog_items` for the resolved category to return a realistic total, so the frontend knows there are thousands more.

```
// Add near line 793:
// Get real DB count for this category
const { count: dbCount } = await supabase
  .from("catalog_items")
  .select("id", { count: "exact", head: true })
  .eq("unified_category", parentTab)
  .eq("is_active", true)
  .gt("price_usd", 0);

total = Math.max(ebayTotal, amazonItems.length, finalItems.length, dbCount || 0);
```

#### 2. `ShopHome.tsx` — Remove background auto-fetcher, make Load More manual only
- **Remove** the `categoryBgFetchRef` auto-fetch loop entirely (lines 602-651)
- Keep the cached-data restore (instant display from `categoryProductsCacheRef`)
- `handleCategoryLoadMore` fetches the next page on click only
- Same for store filter: already manual, no changes needed

#### 3. `CategoryResultsPage.tsx` — Remove background fetch loop, manual Load More only
- **Remove** the Phase 2 background loop (lines 206-230) that auto-fetches up to 50 pages
- Keep Phase 1 (first 200 shown instantly)
- `handleShowMore` fetches next page on click
- Remove `visibleCount` slicing — show all fetched products directly (no separate "reveal" step)

#### 4. Make Load More fetch directly from DB for speed
Both pages should use direct Supabase queries (like `fetchAllFromDb` pattern) instead of going through the `catalog-category` edge function for subsequent pages. This gives <100ms response times vs 1-2s through the edge function.

### Files to modify
1. `supabase/functions/catalog-category/index.ts` — Fix `total` to use real DB count
2. `src/pages/shop/ShopHome.tsx` — Remove background auto-fetcher, manual Load More only
3. `src/pages/shop/CategoryResultsPage.tsx` — Remove background loop, manual Load More, direct DB pagination

