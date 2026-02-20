

## Make Search Results Load in Under 1 Second

### Root Cause

The search results page (`SearchResults.tsx`) makes raw `fetch()` calls directly to the backend, **completely bypassing** the `cachedCatalogFetch` / `cachedCatalogFetchWithSwr` system that already exists in `catalogCache.ts`. This means:

- Every search is a cold network request (2-5 seconds)
- Repeat searches for the same term hit the backend again
- No stale-while-revalidate — the user stares at a spinner every time
- The backend already has a 7-day shared cache (`search_cache` table), but the frontend throws away the response instead of caching it locally

### Fix: Three changes to make search feel instant

---

### 1. Use `cachedCatalogFetchWithSwr` for search requests (SearchResults.tsx)

Replace the raw `fetch()` call in `fetchProducts` with `cachedCatalogFetchWithSwr('catalog-search', params)`.

This gives us:
- **Fresh cache hit**: instant return (< 1ms) for repeat searches
- **Stale cache hit**: instant return of old results + silent background refresh that updates the grid when done
- **Cache miss**: normal network fetch, but result is stored for next time

The SWR pattern means even if the cache is slightly expired, the user sees results immediately and they silently refresh.

### 2. Prefetch search on typing with debounce (SearchBar.tsx)

Currently the search bar does nothing until the user presses Enter/submits. We can fire a **silent prefetch** after 400ms of idle typing. By the time they press Enter and navigate to `/search?q=...`, the results are already in the LRU cache.

- Add a `useEffect` with a 400ms debounce on the `query` state
- When triggered, call `prefetchCatalogSearch(query, language)` (fire-and-forget)
- The prefetch populates the same cache key that SearchResults will read

### 3. Add a `prefetchCatalogSearch` helper (catalogCache.ts)

Similar to `prefetchCatalogCategory`, add a search-specific prefetch function that:
- Normalizes the query the same way SearchResults does
- Calls `cachedCatalogFetch('catalog-search', { q, limit: 100, ... })`
- Uses a `Set` to avoid duplicate prefetches for the same query

---

### Technical Details

**File 1: `src/lib/catalogCache.ts`**
- Add `prefetchCatalogSearch(query: string)` function
- Uses same cache key generation as SearchResults will use
- Fire-and-forget with dedup Set

**File 2: `src/components/shop/SearchBar.tsx`**
- Import `prefetchCatalogSearch`
- Add `useEffect` with 400ms debounce on `query` state
- Only prefetch if query length >= 2 characters
- Clear timeout on unmount

**File 3: `src/pages/shop/SearchResults.tsx`**
- Replace `fetchProducts` internal `fetch()` with `cachedCatalogFetchWithSwr`
- On stale hit: show cached results immediately, update grid when fresh data arrives
- On fresh hit: show results instantly (no spinner)
- On miss: fetch normally (same as current behavior but result gets cached)
- Keep all existing dedup, pagination, infinite scroll, and revalidation logic

### Expected Result

| Scenario | Before | After |
|---|---|---|
| First search for "iphone" | 2-5 seconds (spinner) | 2-5 seconds (first time only) |
| Same search again | 2-5 seconds (spinner) | Instant (< 50ms, cache hit) |
| Type "iphone", wait, press Enter | 2-5 seconds | Instant (prefetched while typing) |
| Stale cache | 2-5 seconds (spinner) | Instant stale results + silent refresh |
| Switch language, same query | 2-5 seconds | Instant if normalized query matches |

### No changes to
- Backend edge functions (already has server-side caching)
- Cache TTL strategy (respects server `ttlSeconds`)
- Category pages (already optimized)

