
# Fix Load More + Gaming Tab Results

## Problem Analysis

1. **Load More not loading enough items**: The eBay Browse API fetcher caps requests at 50 items (`EBAY_MAX_LIMIT = 50` in `ebayBrowseSearch.ts`). Even though the frontend requests 100, the backend only fetches 50 from eBay + ~20 from Amazon = ~70 max per page. This makes "Load More" feel broken because pages are underfilled.

2. **Gaming tab not showing Xbox/PS5**: When clicking the Gaming tab with no search query, the code falls back to `category.replace(/_/g, ' ')` which sends "gaming" as the search term. This returns gaming accessories instead of consoles. It needs to send console-specific terms.

## Changes

### File 1: `supabase/functions/_shared/ebayBrowseSearch.ts` (line 13)
Increase `EBAY_MAX_LIMIT` from `50` to `100` so that when the frontend requests 100 items, eBay can return up to 100 per page.

### File 2: `src/pages/shop/SearchResults.tsx` (line 55)
Update the fallback query for the gaming category so it searches for "xbox ps5 nintendo switch console" instead of just "gaming".

**Before:**
```
const searchQuery = query || (category ? category.replace(/_/g, ' ') : 'popular');
```

**After:**
```
const searchQuery = query || (
  category === 'gaming' ? 'xbox ps5 nintendo switch console' :
  (category ? category.replace(/_/g, ' ') : 'popular')
);
```

## Summary

| File | Change |
|------|--------|
| `supabase/functions/_shared/ebayBrowseSearch.ts` | Increase EBAY_MAX_LIMIT from 50 to 100 |
| `src/pages/shop/SearchResults.tsx` | Gaming category default query = "xbox ps5 nintendo switch console" |

## Expected Results
- Load More will fetch up to 100 items per page (3 pages max = 300 items)
- Gaming tab will show Xbox, PS5, Nintendo Switch consoles prominently
