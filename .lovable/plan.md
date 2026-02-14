

# Instant Search: Shared Cache + Client Cache + SWR + No Duplicates

## Overview

Make AfriShop search feel instant by layering client-side caching with the existing server-side cache, adding stale-while-revalidate on the frontend, fixing pagination duplicates, and virtualizing the product grid.

## Current State

- **Server cache**: Already exists via `catalog_cache` table with SWR pattern (stale/expire TTLs, background refresh). Query normalization exists server-side (`normalizeQuery` in `catalogCache.ts`).
- **Client cache**: `src/lib/catalogCache.ts` uses `localStorage` with TTL, but search pages skip cache on pagination (`skipCache: pageNum > 1`). No in-memory LRU. No SWR on client side -- cache miss = full loading spinner.
- **Deduplication**: Basic `dedupeProducts` exists in `SearchResults.tsx` using `id:provider` key, but no persistent `seenIds` across pages.
- **No virtualization**: `ProductGrid` renders all products with `.map()`.

## Changes

### 1. Enhanced Client Cache with In-Memory LRU + SWR (Frontend)

**File: `src/lib/catalogCache.ts`**

- Add an in-memory LRU map (max 50 entries) that sits in front of localStorage
- New `cachedCatalogFetchWithSwr()` function:
  1. Check in-memory LRU first (instant, <1ms)
  2. Check localStorage second (fast, <5ms)
  3. If hit (even expired up to 2x TTL): return data immediately, set `isStale=true`
  4. Fire network request in parallel
  5. On response: update both caches, call an `onUpdate` callback to refresh UI smoothly
- Normalize queries client-side with same logic as server (`normalizeQuery`: trim, lowercase, collapse whitespace, remove diacritics, strip punctuation, keep numbers, max 120 chars)
- `stableStringify(filters)`: sort keys alphabetically for deterministic cache keys

### 2. Search Results with Instant Render + SWR UI (Frontend)

**File: `src/pages/shop/SearchResults.tsx`**

- Replace `cachedCatalogFetch` with new `cachedCatalogFetchWithSwr`
- On cache hit: render products immediately, show subtle "Updating..." badge (not a full spinner)
- On fresh data arrival: smoothly replace product list (no flash)
- Debounce search input at 200ms (already using AbortController for cancellation)
- Maintain a `seenIds` Set across pagination:
  - On page 1: reset `seenIds`
  - On subsequent pages: filter incoming items against `seenIds` before appending
  - Prevents any duplicates across "Load More" clicks

### 3. Virtualized Product Grid (Frontend)

**File: `src/components/shop/ProductGrid.tsx`**

- Use CSS `content-visibility: auto` with `contain-intrinsic-size` on product card wrappers
- This gives virtualization-like benefits without a heavy library dependency
- Memoize `ProductCard` with `React.memo` to prevent unnecessary re-renders

### 4. Server-Side Search Cache Improvements (Backend)

**File: `supabase/functions/catalog-search/index.ts`**

- Add `X-Cache-Status` response header: `HIT`, `STALE`, `MISS` for client-side SWR decisions
- Add `X-Cache-Age` header with cache age in seconds
- Add timing headers: `X-Response-Time` for total ms
- These headers let the client cache make smarter TTL decisions

No new database tables needed -- the existing `catalog_cache` table with its SWR pattern is already robust. The server-side shared cache across users is already working. The main gaps are all on the client side.

## Technical Details

### Files Modified

| File | Change |
|------|--------|
| `src/lib/catalogCache.ts` | Add in-memory LRU, `cachedCatalogFetchWithSwr()`, shared `normalizeQuery`, `stableStringify` |
| `src/pages/shop/SearchResults.tsx` | Use SWR fetch, debounced input, `seenIds` dedup, "Updating..." indicator |
| `src/components/shop/ProductGrid.tsx` | Add `content-visibility: auto` for virtualization |
| `src/components/shop/ProductCard.tsx` | Wrap with `React.memo` |
| `supabase/functions/catalog-search/index.ts` | Add `X-Cache-Status`, `X-Cache-Age`, `X-Response-Time` headers |

### No New Dependencies

All changes use native browser APIs (localStorage, Map, IntersectionObserver, `content-visibility` CSS). No new npm packages needed.

### Performance Targets

| Scenario | Current | After |
|----------|---------|-------|
| Repeat search (same user) | ~500-2000ms (network) | <5ms (memory LRU) |
| Repeat search (different user, same query) | ~500-2000ms (server cache hit but full round-trip) | ~100-300ms (client shows stale, refreshes in background) |
| First-ever search | ~1-3s | ~1-3s (unchanged, but with skeleton instead of spinner) |
| Load More duplicates | Possible | Zero (seenIds filter) |

### What Is NOT Changed

- No payment, checkout, or category logic changes
- No business rules or product filtering changes
- No new database tables or migrations
- Server-side cache TTLs remain as configured
- Existing admin cache-clear functionality continues to work

