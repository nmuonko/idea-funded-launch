

# Homepage Performance Optimization Plan

## Problem Analysis

`ShopHome.tsx` is **1,607 lines** — a monolithic component with ~500 lines of static configuration data, complex per-category fetch logic with multiple fallback paths, and heavy runtime filtering. Key bottlenecks:

1. **Massive static data inlined**: ~200 lines of keyword/exclude arrays are parsed on every render
2. **Waterfall fetches**: Pinned items fetch → then accueil feed → then category fetches (sequential chain via `useEffect` dependency on `pinnedByCategory`)
3. **Redundant category fetching**: When pinned items exist, the component still triggers `fetchCategoryItems` for unpinned categories AND `fetchAccueilFeed` — both run sequentially after pins resolve
4. **Heavy per-category special paths**: 6 special-case category handlers (vehicles, clothing, jewelry, parts, cameras, standard) each making 3-8 sequential API calls with fallback chains — but these are **dead code when pins exist**
5. **`trendingFeed` recomputes expensively**: Filters `combinedPool` through `isRelevantToCategory` for 13 categories on every render when `accueilProducts` or `pinnedByCategory` changes
6. **`applyFilters` called inline in JSX**: Creates new arrays on every render for trending, recently viewed, and each category section

## Changes

### 1. Extract Static Data to a Separate Module
**New file: `src/lib/categoryConfig.ts`**
- Move all `CATEGORY_TITLE_MAP`, `CATEGORY_SEARCH_QUERIES`, `CATEGORY_KEYWORDS`, `CATEGORY_EXCLUDE_KEYWORDS`, `GLOBAL_*_TERMS`, and helper functions (`getEffectiveExcludes`, `isRelevantToCategory`, `filterForCategory`, `sortByLuxury`) out of the component
- This eliminates ~400 lines from ShopHome and prevents re-parsing on each module evaluation

### 2. Parallelize Initial Data Fetching
**File: `src/pages/shop/ShopHome.tsx`**
- Fetch pinned items, accueil feed, and active providers **in parallel** instead of sequentially
- Remove the `useEffect` dependency chain where category fetches wait for `pinnedByCategory` to resolve
- Use a single `useEffect` that runs `Promise.all([fetchPinned, fetchAccueil, fetchProviders])`, then determines which categories still need dynamic fetching

### 3. Skip Dead-Code Fetch Paths When Pins Exist
- In `fetchCategoryItems`, add an early return for categories that have pinned items — currently the function runs all the special-case logic (vehicles, clothing, etc.) even when pins will override the result
- This eliminates dozens of unnecessary API calls on homepage load

### 4. Memoize Filtered Results
- Wrap `applyFilters(trendingFeed)`, `applyFilters(recentlyViewed)`, and per-category pin/fallback selections in `useMemo` instead of computing inline in JSX
- This prevents re-creating arrays on every render cycle

### 5. Reduce `trendingFeed` Computation
- Pre-group pinned items by provider during the pinned fetch, avoiding repeated `.filter()` calls inside the trending memo
- Use early termination once 16 items are collected instead of processing all 13 categories

### 6. Lazy-load the Category Fetch Logic
- Move the special-case category handlers (vehicles, clothing, jewelry, etc.) into a separate async module that's only imported when actually needed (i.e., when a category has no pins)
- This reduces the initial JS bundle for the common case where all categories are pinned

## Files to Modify

| File | Action |
|------|--------|
| `src/lib/categoryConfig.ts` | Create — extract ~400 lines of static data + helpers |
| `src/pages/shop/ShopHome.tsx` | Refactor — parallel fetches, skip pinned categories, memoize filters, import from categoryConfig |

## Expected Impact
- **Initial load**: 3-5 fewer sequential API calls (parallel instead of waterfall)
- **Bundle**: ~400 lines of static data tree-shaken into separate chunk
- **Render**: Fewer re-computations per frame from memoized filter results
- **Network**: Categories with pins skip all fallback fetch chains entirely

