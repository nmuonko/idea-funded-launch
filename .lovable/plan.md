

# Show More Search Results with Relevance Priority

## What Changes

The search page will load more products per fetch, support a higher total cap, and auto-load additional pages more aggressively -- so users see a dense, scrollable grid of results starting with the most relevant items.

## Changes

### 1. Increase Result Limits
- Raise `PAGE_SIZE` from 100 to 200 items per fetch (fewer round-trips, faster grid fill)
- Raise `HARD_MAX_ITEMS` from 500 to 1000 (doubles the scrollable depth)
- Raise `BROADEN_TARGET` from 300 to 500 (more similar-query backfill)

### 2. Show More Grid Items on Screen
- Change the ProductGrid columns on search results to `2 cols mobile / 3 sm / 4 md / 5 lg / 6 xl` for slightly larger, more readable cards while still showing many items
- Increase skeleton count from 16 to 24 for a fuller loading state

### 3. More Aggressive Auto-Loading
- Increase the IntersectionObserver `rootMargin` from `800px` to `1200px` so the next page starts loading earlier as the user scrolls, creating a seamless infinite scroll experience

### 4. Relevance Order (Already Handled)
The backend already returns results in relevance order (AI-rewritten query, token matching, similarity scoring). The frontend preserves this order. No changes needed here -- just confirming the "most pertinent first" requirement is already met.

---

## Technical Details

| File | Change |
|------|--------|
| `src/pages/shop/SearchResults.tsx` | Update `PAGE_SIZE` to 200, `HARD_MAX_ITEMS` to 1000, `BROADEN_TARGET` to 500, skeleton count to 24, rootMargin to 1200px |
| `src/components/shop/ProductGrid.tsx` | Adjust grid columns for search context: use `grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6` via a new `dense` prop (keeps existing compact 3-8 col layout for homepage) |

