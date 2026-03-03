

# Plan: Add Category Filters + Fix Missing Stores

## Key Finding

The database currently only contains products from **6 providers**: eBay (385k), Rainforest/Amazon (13.6k), Carvana (79), CarGurus (55), Amazon (1), SHEIN (1). **Walmart, Best Buy, Macy's, Home Depot, Wayfair, Temu, Ford, Toyota, Tesla do NOT exist in the catalog yet.** The dynamic dropdown is working correctly — it only shows stores that have cached products.

## Plan

### 1. Add Category Filter Dropdown (Phones, Vehicles, Clothes)

**File: `src/pages/shop/ShopHome.tsx`**

Add a second dropdown next to the store filter for category filtering. Options:
- All Categories (default)
- Phones
- Vehicles  
- Clothes/Fashion

When a category is selected, filter products using the existing `CATEGORY_KEYWORDS` map (already defined at lines 62-78). This works with both the home feed and store-filtered views by matching keywords against product titles client-side. This will be instant since it's purely client-side filtering on already-loaded data.

When both a store and category filter are active, apply both filters together.

### 2. Add Hardcoded Popular Store Options That Aren't in DB Yet

Since Walmart, Temu, Best Buy, Macy's, Home Depot, Wayfair, Ford, Toyota, Tesla have **zero** cached products, the dynamic RPC correctly excludes them. Two options:

**Option A (Recommended):** Add these as static entries in the dropdown with a count of 0, shown grayed out or with a "(coming soon)" label, so users know they exist but have no products yet.

**Option B:** Only show stores with actual products (current behavior) — but inform the user that those stores need to be ingested into the catalog first before they can appear.

### Summary of Changes

| File | Change |
|------|--------|
| `src/pages/shop/ShopHome.tsx` | Add category filter dropdown (phones/vehicles/clothes); add static store entries for popular stores not yet in DB |

No database changes needed — category filtering is client-side using existing keyword maps, and the missing stores simply don't have data yet.

