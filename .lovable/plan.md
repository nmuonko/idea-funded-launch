
# Fix: Accurate Product Count + Auto-Load to 300 Products

## Problems

1. **Inaccurate product count**: The "37 produits trouves" text only shows the count of items in the current API response (`data.total`), not the cumulative total of all loaded products. As users load more pages, it should update to reflect all displayed products.

2. **Only ~36 products displayed**: The backend returns a valid `nextCursor` and `hasMore: true` when more results exist, but the user has to manually click "Load More". The system supports up to 3 pages of 100 items (300 total), but users only see page 1. The "Load More" button may also not appear if `hasMore` evaluates incorrectly on the frontend.

## Changes

### 1. Fix product count to show cumulative loaded products

**File: `src/pages/shop/SearchResults.tsx`**

Change `totalResults` to always reflect the actual number of products currently displayed (accumulated across pages), not the backend's `total` field which only represents a single page.

- After appending products, set `totalResults` to the length of the deduplicated combined array
- For page 1, set it to the mapped products length
- Remove reliance on `data.total` from the backend (which is unreliable -- it uses `Math.max(ebayTotal, amazonItems.length, finalItems.length)` which can be misleading)

### 2. Add auto-loading (infinite scroll) to reach 300 products

**File: `src/pages/shop/SearchResults.tsx`**

Instead of requiring manual "Load More" clicks, implement an `IntersectionObserver` that automatically triggers the next page load when the user scrolls near the bottom:

- Add a sentinel div at the bottom of the product grid
- Use `IntersectionObserver` to detect when the sentinel enters the viewport
- Automatically call `handleLoadMore()` when visible, up to page 3 (300 items max)
- Keep the manual "Load More" button as a fallback in case auto-load doesn't trigger
- Show a loading spinner at the bottom while fetching the next page

### 3. Fix `hasMore` logic on frontend

**File: `src/pages/shop/SearchResults.tsx` (line 122)**

Current logic:
```
setHasMore((!!newCursor || data?.hasMore === true || mappedProducts.length >= 100) && pageNum < 3);
```

This is mostly correct but `mappedProducts.length >= 100` could false-positive. Simplify to rely on backend signals:
```
setHasMore((!!newCursor || data?.hasMore === true) && pageNum < 3);
```

## Technical Details

### Updated product count logic
```typescript
// After setting products:
if (append) {
  const deduped = dedupeProducts([...prev, ...mappedProducts]);
  setProducts(deduped);
  setTotalResults(deduped.length); // Cumulative count
} else {
  setProducts(mappedProducts);
  setTotalResults(mappedProducts.length);
}
```

### Infinite scroll implementation
```typescript
// Sentinel ref + IntersectionObserver
const sentinelRef = useRef<HTMLDivElement>(null);

useEffect(() => {
  if (!sentinelRef.current || !hasMore || loading || loadingMore) return;
  const observer = new IntersectionObserver(
    ([entry]) => { if (entry.isIntersecting) handleLoadMore(); },
    { rootMargin: '400px' }
  );
  observer.observe(sentinelRef.current);
  return () => observer.disconnect();
}, [hasMore, loading, loadingMore, handleLoadMore]);
```

### Files Modified

| File | Change |
|------|--------|
| `src/pages/shop/SearchResults.tsx` | Fix product count to be cumulative, add infinite scroll, fix hasMore logic |

### Expected Result
- Product count shows actual number of displayed items (e.g., "94 produits trouves" after page 1, "188" after page 2, up to "300")
- Products auto-load as user scrolls down, up to 3 pages (300 items)
- Manual "Load More" button remains as fallback
- No more misleading "10000" or "37" counts
