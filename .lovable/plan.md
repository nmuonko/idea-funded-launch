

# Fix Homepage: Manual Control, Amazon Inclusion, 4 Full-Picture Items Per Category

## Problem Summary

1. **Auto-rotation every 48-72h**: The `home-auto-refresh` cron and `catalog-home` cache TTL cause homepage products to change automatically. You want **manual-only** control.
2. **Unattractive items**: The current fetch logic uses live search queries with random/rotated results, producing inconsistent quality.
3. **No Amazon items**: The `fetchItemsFromDB` in `homeRecipeBuilder.ts` queries `search_catalog_items_ranked` which returns items from all providers, but the frontend category fetch (`ShopHome.tsx`) relies on `catalog-home` and `catalog-search` which may not surface Amazon (rainforest) items prominently. You have 46,000+ Amazon items in the catalog.
4. **Categories need exactly 4 items with full pictures**: Already showing 4, but image quality is inconsistent.

---

## Changes

### 1. Disable Auto-Refresh (Keep Manual "Publish" Only)

**File: `supabase/functions/home-auto-refresh/index.ts`**
- Add a check: if auto-refresh is disabled in settings, return early without rebuilding
- The admin "Publish All" button in Home Curation will remain the **only** way to update homepage content

**Database: `home_refresh_settings`**
- Set `mobile_refresh_hours` and `web_refresh_hours` to `0` (disables auto-rebuild)
- Or add a `auto_refresh_enabled = false` flag

**File: `supabase/functions/catalog-home/index.ts`**
- Remove the async background rebuild that triggers when cache is stale (lines ~1127 and ~1339)
- Cache should serve stale data indefinitely until admin manually rebuilds
- Only rebuild when explicitly triggered from admin portal

### 2. Admin Portal: Add "Pin Products" Feature per Category

**File: `src/pages/admin/HomeRecipes.tsx`**
- Add a new section: **"Homepage Category Pins"** — a simple UI where you can:
  - Search the `catalog_items` database for any product (including Amazon/rainforest)
  - Pin exactly 4 products per category
  - Drag to reorder
  - Preview the product image before pinning
- Pinned products are stored in a new table

**New Database Table: `homepage_pinned_items`**
```sql
CREATE TABLE homepage_pinned_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_key TEXT NOT NULL,
  catalog_item_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  provider_product_id TEXT NOT NULL,
  title TEXT,
  image_url TEXT,
  price_usd NUMERIC,
  sort_order INT NOT NULL DEFAULT 0,
  pinned_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(category_key, catalog_item_id)
);
ALTER TABLE homepage_pinned_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins_manage_pins" ON homepage_pinned_items FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
```

### 3. Frontend: Use Pinned Items First, Fallback to Current Logic

**File: `src/pages/shop/ShopHome.tsx`**
- At startup, fetch `homepage_pinned_items` ordered by `category_key, sort_order`
- For each category: if pinned items exist (up to 4), use those directly — skip the complex `fetchCategoryItems` logic
- Only fall back to the current search-based fetch if no pins exist for a category
- This makes the homepage **deterministic** and **admin-controlled**

### 4. Ensure Amazon Items Are Searchable in Admin Pin UI

**Admin search in pin UI:**
- Query `catalog_items` directly with `ilike` on title, filtered by category keywords
- Include `provider IN ('ebay', 'rainforest', 'cargurus', 'carvana', 'shein')` to ensure Amazon items appear
- Show provider badge next to each search result so admin can see the source
- Filter to only show items with valid `image_url` (non-null, passes `isValidProductImageUrl`)

### 5. Enforce Full Pictures (4 Per Category)

**File: `src/components/shop/CategoryCard.tsx`**
- Already shows exactly 4 items in a 2x2 grid with `aspect-square` and `object-contain` on white background
- Add stricter image validation: skip pinned items whose `image_url` fails to load (fallback to placeholder)
- The admin pin UI will preview images before allowing a pin, preventing bad images from being selected

---

## Architecture Summary

```text
BEFORE:
  Cron (48-72h) → auto-refresh → random items from DB seeds
  Frontend → catalog-home/catalog-search → random results each time

AFTER:
  Admin Portal → search catalog_items → pin 4 items per category
  Frontend → fetch homepage_pinned_items → deterministic display
  Manual "Publish All" → only for recipe-based mobile/web cache
  Auto-refresh → disabled
```

## Files to Create/Modify

| File | Action |
|------|--------|
| `homepage_pinned_items` table | Create (migration) |
| `src/pages/admin/HomeRecipes.tsx` | Add pinned items management UI |
| `src/pages/shop/ShopHome.tsx` | Fetch pins first, skip search if pins exist |
| `supabase/functions/home-auto-refresh/index.ts` | Disable auto-rebuild |
| `supabase/functions/catalog-home/index.ts` | Remove background async rebuilds |

