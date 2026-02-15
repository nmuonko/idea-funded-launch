

# Fix Homepage Double-Click Empty State and Stale Toys Content

## Problem 1: "No products available" on re-clicking Homepage tab

**Root cause found**: When you click the "Homepage" tab in CategoryTabs while already viewing it, `handleCategoryChange('all')` runs and does this:

```
setActiveCategory('all');   // same value -- React skips re-render
setProducts([]);            // CLEARS the product list
setHasMore(true);
```

Since `activeCategory` doesn't actually change, the `useEffect` watching `[language, activeCategory]` never re-fires, so `fetchFeed` is never called again. Result: empty screen with "No products available."

**Fix**: Add a guard in `handleCategoryChange` -- if the category is already active, do nothing (don't clear products). This is a 2-line fix.

## Problem 2: Homepage showing only toys (LEGO, Barbie, Nerf)

**Root cause found**: The backend recipe cache (`recipe_cache` source) currently has 85 items, and many of the seed queries like "LEGO set", combined with eBay results for "barbie doll accessories" and "nerf gun blaster", are producing a toys-heavy feed. The other seeds (iPhone, MacBook, Nike, etc.) may have returned fewer results or failed during the last recipe build.

**Fix**: Trigger a recipe rebuild from the admin panel to refresh the cached pool with balanced results across all seeds. No frontend code change needed for this -- it's a data/cache freshness issue.

## Technical Changes

### File: `src/pages/shop/ShopHome.tsx`

- In `handleCategoryChange`: add early return if `category === activeCategory` to prevent clearing products when the same tab is clicked again.

```typescript
const handleCategoryChange = (category: string) => {
  if (category === activeCategory) return; // Don't clear if same tab
  setActiveCategory(category);
  setCurrentPage(1);
  setTotalPages(0);
  setProducts([]);
  setHasMore(true);
};
```

This single guard prevents the empty state on re-click while still allowing normal category switching.

