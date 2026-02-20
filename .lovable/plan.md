

## Make Category Pages Load Instantly (~0-2 seconds)

### Strategy: Prefetch on Hover + Instant Cache Hit

Right now, clicking "Voir plus" navigates to `/category/:key`, which starts a fresh network request. Even with progressive rendering, the first request still takes 2-5 seconds. The fix: **start fetching before the user clicks**.

---

### Change 1: Prefetch on Hover/Touch (CategoryCard.tsx)

When the user hovers over or touches the "Voir plus" button (or the entire category card), fire a **silent background fetch** for that category's first page. This means:

- On desktop: `onMouseEnter` on the card or "Voir plus" button triggers a prefetch
- On mobile: `onTouchStart` on the "Voir plus" button triggers a prefetch

The prefetch calls `cachedCatalogFetch('catalog-category', { category, pageSize: 100, ... })` -- the exact same call `CategoryResultsPage` will make. Since `cachedCatalogFetch` stores results in the LRU memory cache and localStorage, the page's `fetchPage(null)` call will get an instant cache hit (< 1ms).

**Implementation:**
- Add a `prefetchCategory` function that calls `cachedCatalogFetch` silently (fire-and-forget, no error handling needed)
- Attach `onMouseEnter` to the category card container
- Attach `onTouchStart` to the "Voir plus" button
- Use a module-level `Set` to avoid duplicate prefetch calls for the same category

---

### Change 2: Prefetch Visible Categories on Idle (ShopHome.tsx)

As a secondary optimization, after the homepage finishes loading its own data, use `requestIdleCallback` (or `setTimeout` fallback) to prefetch the first page for all visible category grids. This means even without hovering, if the user has been on the homepage for a few seconds, the category data is already cached.

**Implementation:**
- After all homepage sections finish loading, schedule idle prefetch for each category key
- Use the same `cachedCatalogFetch` call so cache keys match exactly
- Limit to 3-4 categories at a time to avoid overwhelming the network

---

### Change 3: Use Navigator Link Prefetch Hint (CategoryCard.tsx)

Change the "Voir plus" `<button onClick={navigate(...)}>` to a `<Link to={...}>` with `onMouseEnter` prefetch. This also lets the browser preload the route component chunk.

---

### Technical Details

**File 1: `src/lib/catalogCache.ts`**
- Add a new exported `prefetchCatalogCategory(categoryKey, language)` helper function:
  ```
  const prefetchedKeys = new Set<string>();
  export function prefetchCatalogCategory(category: string, language: string) {
    const key = `${category}:${language}`;
    if (prefetchedKeys.has(key)) return;
    prefetchedKeys.add(key);
    cachedCatalogFetch('catalog-category', {
      category, pageSize: 100, client: 'web', language
    }).catch(() => {});  // silent, fire-and-forget
  }
  ```

**File 2: `src/components/shop/CategoryCard.tsx`**
- Import `prefetchCatalogCategory` from `catalogCache`
- Add `onMouseEnter` handler on the card container that calls `prefetchCatalogCategory(categoryKey, language)`
- Add `onTouchStart` handler on the "Voir plus" button that calls the same function
- Convert "Voir plus" button to `<Link>` for better navigation semantics

**File 3: `src/pages/shop/ShopHome.tsx`**
- After homepage data loads, schedule idle prefetch for the visible category keys using `requestIdleCallback` or `setTimeout(..., 3000)`
- Call `prefetchCatalogCategory` for each category, staggered by ~500ms to avoid network congestion

### Expected Result

- **Hover then click**: Data already cached, page renders in < 500ms (just React mount time)
- **Quick click (no hover)**: Same as current behavior (~2-3 seconds for first batch)
- **Idle on homepage > 3 seconds**: All categories pre-cached, any click is instant
- Second visit to same category: Always instant (localStorage cache with 1-hour TTL)

### No changes to
- Backend / edge functions
- CategoryResultsPage.tsx (already has progressive rendering)
- Cache TTL or storage strategy

