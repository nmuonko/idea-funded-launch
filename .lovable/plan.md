
# Fix Homepage, Gaming & Load More on Search Page

## Problem Summary

1. **Accueil tab shows books**: Clicking "Accueil" on the search page stays on `/search` and searches for "popular" (returning random books). It should navigate to the homepage `/`.
2. **Gaming tab shows accessories**: The default query "xbox ps5 nintendo switch console" matches accessories. Needs negative keywords to exclude them.
3. **Load More disappears**: The button vanishes because `hasMore` only checks for a `nextCursor` flag. If the backend returns 100 items without a cursor, the button hides prematurely.

## Changes (single file)

### `src/pages/shop/SearchResults.tsx`

**Fix 1 -- Homepage navigation (lines 172-177)**

When user clicks "Accueil/Homepage" (`all`), navigate to `/` instead of staying on search page.

```text
Before: setSearchParams({ q: query, sort })
After:  navigate('/')
```

**Fix 2 -- Gaming query (lines 55-58)**

Add negative keywords to exclude accessories and also handle legacy `electronics` key:

```text
Before: category === 'gaming' ? 'xbox ps5 nintendo switch console'
After:  (category === 'gaming' || category === 'electronics')
          ? 'xbox console ps5 console nintendo switch video games -case -cover -charger -skin -controller -protector'
```

**Fix 3 -- Load More persistence (line 120)**

Consider items count alongside cursor. If a full page of 100 items was returned, assume more may exist:

```text
Before: setHasMore((!!newCursor || data?.hasMore === true) && pageNum < 3)
After:  setHasMore((!!newCursor || data?.hasMore === true || mappedProducts.length >= 100) && pageNum < 3)
```

## Files Modified

| File | Change |
|------|--------|
| `src/pages/shop/SearchResults.tsx` | Navigate to `/` for homepage tab; gaming query with negative keywords; resilient Load More logic |
