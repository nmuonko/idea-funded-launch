
# Fix: Vehicles Tab Empty Results + Hamburger Position

## Issue 1: Vehicles Tab Shows "No Products Found"

**Root Cause:** When clicking the "Vehicles" tab, the frontend navigates to `/search?category=vehicles` with no search query. In `SearchResults.tsx` line 56-60, the fallback query for an empty `query` with category `vehicles` becomes just the string `"vehicles"` -- which is too generic and returns no results from the search engine.

Meanwhile, the `catalog-category` edge function has proper default queries for each category (e.g., `vehicles: "cars"`, `vehicles_cars_trucks: "cars"`), but the frontend never calls `catalog-category` -- it always uses `catalog-search`.

**Fix:** In `src/pages/shop/SearchResults.tsx`, add a `DEFAULT_CATEGORY_QUERIES` map (matching the backend's `AMAZON_DEFAULT_QUERIES`) so the vehicles tab sends a meaningful query like `"cars"` instead of `"vehicles"`.

```typescript
const DEFAULT_CATEGORY_QUERIES: Record<string, string> = {
  gaming: 'video game console',
  electronics: 'iphone',
  vehicles: 'cars trucks SUV',
  home: 'sofa furniture',
  fashion: 'shoes clothing',
  toys: 'lego toys',
  sporting_goods: 'fitness equipment',
  watches: 'watch jewelry',
  refurbished: 'refurbished phone laptop',
};
```

Then update line 56-60:
```typescript
const searchQuery = query || DEFAULT_CATEGORY_QUERIES[category] || category.replace(/_/g, ' ') || 'popular';
```

## Issue 2: Hamburger Menu Position (Move to Far Right)

**Current state:** The hamburger (3 bars) is on the far left per the previous plan. The user now wants it on the far right.

**Fix:** In `src/components/shop/ShopHeader.tsx`, reorder the header elements:
1. Logo (far left)
2. Search bar (middle, flex-1)
3. Cart icon
4. Hamburger menu (far right)

## Summary

| File | Change |
|------|--------|
| `src/pages/shop/SearchResults.tsx` | Add `DEFAULT_CATEGORY_QUERIES` map for meaningful category fallback queries |
| `src/components/shop/ShopHeader.tsx` | Move hamburger menu from far left to far right |
