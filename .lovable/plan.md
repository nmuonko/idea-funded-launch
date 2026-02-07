

# Fix "Load More" Repeating Results in Search

## Root Cause

The frontend sends `cursor` only when `nextCursor` is non-null (line 73). However, the fallback on line 110 sets `hasMore = true` even when `nextCursor` is null (via `data?.hasMore` or `items.length === 24`). This means "Load More" stays visible, but the next request has no cursor, so the backend returns page 1 again.

Additionally, there is no deduplication -- if any items overlap between responses, they appear twice in the grid.

## Changes (1 file)

**File: `src/pages/shop/SearchResults.tsx`**

### 1. Add page-based fallback when cursor is unavailable

When the backend does not return a `nextCursor`, fall back to offset-based pagination by sending `page` as a query parameter. This covers edge cases where the mixer cursor is null but more results exist.

```text
// In fetchProducts, before the fetch call:
if (pageNum > 1 && nextCursor) {
  params.cursor = nextCursor;
} else if (pageNum > 1) {
  params.page = pageNum;          // <-- fallback
}
```

### 2. Fix hasMore logic -- only true when pagination is possible

```text
// After response:
const newCursor = data?.nextCursor || null;
setNextCursor(newCursor);

// hasMore only if we have a cursor OR backend explicitly says hasMore
setHasMore(!!newCursor || (data?.hasMore === true));
```

Remove the `mappedProducts.length === 24` fallback -- it's the root cause of the ghost "Load More" that refetches page 1.

### 3. Deduplicate appended results

Add a helper and use it when appending:

```text
function dedupeProducts(list: Product[]): Product[] {
  const seen = new Set<string>();
  return list.filter(p => {
    const key = p.id + ':' + p.provider;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// In the append branch:
setProducts(prev => dedupeProducts([...prev, ...mappedProducts]));
```

### 4. Add debug logging

```text
console.log('[SEARCH] fetch page=', pageNum, 'q=', params.q,
  'cursor=', params.cursor || 'none', 'append=', append);

// After response:
console.log('[SEARCH] got items=', mappedProducts.length,
  'nextCursor=', !!newCursor, 'hasMore=', hasMore);
```

### 5. Remove `products.length` and `nextCursor` from useCallback deps

These cause `fetchProducts` to be recreated on every render/response, which is unnecessary and can lead to stale closure issues. Use a ref for `nextCursor` instead, or simply read it via the state setter pattern. The simplest approach: move `nextCursor` to a ref so the callback is stable.

```text
const nextCursorRef = useRef<string | null>(null);

// In fetchProducts:
if (pageNum > 1 && nextCursorRef.current) {
  params.cursor = nextCursorRef.current;
} else if (pageNum > 1) {
  params.page = pageNum;
}

// After response:
nextCursorRef.current = data?.nextCursor || null;
```

This eliminates the stale closure problem entirely and keeps the `useCallback` deps minimal: `[query, category, sort, priceRange]`.

## Summary of changes

All changes are in `src/pages/shop/SearchResults.tsx`:
- Replace `nextCursor` state with a ref for stable callback
- Add `page` fallback param when cursor is absent
- Fix `hasMore` to not use item-count heuristic
- Deduplicate on append
- Add console logs for debugging

No backend changes needed -- the backend already supports both cursor and page-based pagination.
