

## Issues Identified

### 1. Audio & Music showing ad/banner images instead of product photos
The `audio_music` category follows the **standard path** (line 1094) which fetches from `catalog-home` and `catalog-search`. The `isRenderableImageUrl` filter on the client side catches many bad images, but the real problem is upstream: the `search_catalog_items_ranked` RPC and the recipe builder fetch items from `catalog_items` without filtering out promotional/banner images at the DB level. Items with banner-like `image_url` values pass through because the builder only checks `!imageUrl` (null), not image quality. The client-side `mapItemToProduct` (line 201) copies `image_url` directly without running it through `isRenderableImageUrl`.

**Fix**: Apply `isRenderableImageUrl` filtering in the `mapItemToProduct` and `mapSearchItemToProduct` helpers so that products with banner/ad images are excluded before they reach the grid. Also add the same filtering in the `filterForCategory` pipeline for the standard category path.

### 2. Homepage products all from eBay — no Amazon mix
The `accueilProducts` feed comes from `catalog-home` (line 693), which uses `buildWebHomepage`. This builder queries `search_catalog_items_ranked` RPC, which searches across ALL providers in `catalog_items`. However, the RPC uses `pg_trgm` similarity ranking, and if eBay items dominate the database for certain seed queries, they'll rank higher. The real issue is that `search_catalog_items_ranked` doesn't enforce provider diversity. With 13k+ Amazon products now in the DB, they should appear but may be stored under provider `'rainforest'` rather than `'amazon'`, which could affect relevance scoring.

**Fix**: In the `trendingFeed` memo (line 1166) and the standard category path, add provider-diversity logic that interleaves Amazon/rainforest products with eBay products. Also, for the standard category search fallback path, ensure the DB queries don't filter out Amazon items by adding `'rainforest'` and `'amazon'` explicitly.

### 3. Vehicles showing only 2 instead of 4
The vehicles path (line 825) runs 4 exact queries sequentially. If 2 of the 4 queries return no valid matches from `catalog-search`, only 2 items appear. The queries are very specific (e.g., "2026 Tesla Model Y Long Range", "2025 GMC Yukon XL AT4 Ultimate 4WD Lifted Vossens") and may not match any items in the catalog. There's no fallback to broader vehicle queries when exact matches fail.

**Fix**: Add a fallback after the exact queries: if `items.length < 4`, run broader vehicle queries (e.g., "Tesla SUV", "GMC Yukon", "Ford Explorer", "Hyundai Santa Fe") using `searchVehicles()` to fill remaining slots.

---

## Implementation Plan

### Step 1: Fix image filtering in product mappers
In `ShopHome.tsx`, update `mapItemToProduct` and `mapSearchItemToProduct` to run image URLs through `isRenderableImageUrl`, returning empty `imageUrl` for bad images. Then ensure `isValidProduct` catches these (it already checks `p.imageUrl`).

### Step 2: Add provider diversity to trending feed and standard categories
In the `trendingFeed` memo, after collecting items, interleave so that consecutive items aren't all from the same provider. In the standard category path, ensure Amazon (`rainforest`) products are included by not accidentally filtering them.

### Step 3: Add vehicle query fallback
After the exact vehicle queries loop (line 867), if `items.length < 4`, run broader queries using the existing `searchVehicles` helper with fallback queries like `"Tesla Model Y"`, `"GMC Yukon SUV"`, `"Ford Explorer SUV"`, `"Hyundai Santa Fe"` to fill remaining slots.

