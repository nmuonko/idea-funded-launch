
## Fix: "See More" Only Shows ~34 Products + Slow Loading

### Root Cause

The backend `catalog-category` uses **cursor-based pagination** (it returns a `nextCursor` token with each response). However, the current `CategoryResultsPage` sends `page: 1`, `page: 2`, `page: 3`... which the backend ignores. So every request returns the **same first ~50 items**, they get deduplicated to 0 new items, and the loop exits -- resulting in only ~34-50 products shown after multiple wasted network calls.

### The Fix

Store the `nextCursor` from each response and pass it as the `cursor` parameter on the next request -- exactly how `SearchResults.tsx` already does it.

### Changes (single file: `src/pages/shop/CategoryResultsPage.tsx`)

**1. Add a cursor ref to track pagination state**
- Add `cursorRef = useRef<string | null>(null)` alongside the existing `pageRef` and `exhaustedRef`.

**2. Update `fetchPage` to accept and send cursor**
- Change `fetchPage(page)` to `fetchPage(cursor)`.
- Pass `cursor` to `cachedCatalogFetch` params (alongside existing `category`, `pageSize`, `language`).
- Remove the `page` param (backend ignores it for cursor-based pagination).
- After each response, store `data.nextCursor` in `cursorRef`.
- Mark exhausted when `nextCursor` is null/empty or 0 new items returned.

**3. Update initial load loop**
- Reset `cursorRef.current = null` on category change.
- Loop condition: `accumulated.length < POOL_TARGET && !exhaustedRef.current && requestCount < 10`.
- Each iteration calls `fetchPage(cursorRef.current)` -- first call sends null (page 1), subsequent calls send the cursor from the previous response.

**4. Update `handleShowMore` to pass cursor**
- When fetching more items on scroll, pass `cursorRef.current` instead of `pageRef.current`.

**5. Speed improvement (automatic)**
- Currently 3+ requests return duplicate data and waste time. With cursor pagination, each request returns truly new items, so 3 requests at 100 items each reaches 300 items with no wasted calls.

### Expected Result
- First request: ~50-100 items (new)
- Second request: ~50-100 more items (new, via cursor)
- Third request: ~50-100 more items (new, via cursor)
- Total: up to 300 unique items, loaded in 3 fast sequential requests instead of 10 wasted ones.
- "34 products" issue is resolved since no items are lost to false deduplication.

### No changes to
- Backend / edge functions
- ShopHome.tsx / grids
- catalogCache.ts (cache key already includes all params, so `cursor=xyz` makes each page's cache unique)
