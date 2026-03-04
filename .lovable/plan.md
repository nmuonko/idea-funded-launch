

## Fix: "All Categories" Page Shows No Products

### Problem
When navigating to `/category/all` (via "See more" on the Trending section), the `CategoryResultsPage` calls `catalog-category?category=all`. The backend rejects `"all"` as an invalid category key since it doesn't exist in the category registry, returning 0 items.

### Solution
Handle `"all"` as a special case in `CategoryResultsPage` by querying the `catalog_items` table directly instead of calling the `catalog-category` edge function. This avoids modifying the backend registry and keeps the "all" concept as a frontend concern.

### Changes

**1. `src/pages/shop/CategoryResultsPage.tsx`**
- When `categoryKey === 'all'`, bypass `catalog-category` and instead query `catalog_items` directly from the database using the Supabase client
- Query: select active, non-disallowed items with valid price, ordered by `popularity_score` descending, with cursor-based pagination using `range()`
- Title: "Toutes les catégories" / "All Categories"
- Keep the existing two-phase loading pattern (show first batch immediately, load more in background)

**2. Add `'all'` to `CATEGORY_TITLE_MAP`**
- Add entry: `all: { fr: 'Toutes les catégories', en: 'All Categories' }`

### Technical Detail
The direct DB query for "all" will:
```sql
SELECT id, provider, provider_product_id, title, image_url, images, 
       product_url, price_usd, rating, in_stock
FROM catalog_items
WHERE is_active = true AND is_disallowed = false AND price_usd > 0
ORDER BY popularity_score DESC NULLS LAST
LIMIT 200 OFFSET {page * 200}
```

This leverages the existing public RLS policy on `catalog_items` and avoids the 1000-row limit by paginating in 200-item batches.

