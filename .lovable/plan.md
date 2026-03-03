

# Fix Plan: Instant Store Filters, Missing Stores, Image Quality, Cart Duplicates

## Issue 1: Missing Stores in Filter Dropdown

**Root cause:** The store dropdown is hardcoded to only 5 stores (Amazon, eBay, SHEIN, Carvana, CarGurus). Any new providers added to the catalog won't appear.

**Fix:** Make the dropdown dynamic — query `SELECT DISTINCT provider FROM catalog_items WHERE is_active = true` on mount and build the options list from that. Map display names (e.g., `rainforest` → `Amazon`). This ensures all stores with cached products always appear.

**File:** `src/pages/shop/ShopHome.tsx`
- Add a `useEffect` that fetches distinct providers from `catalog_items` on mount
- Store in state, render dynamically in the `<Select>` dropdown
- Merge `rainforest` + `amazon` under one "Amazon" label

## Issue 2: Store Filter Still Slow on First Selection

**Root cause:** Each store filter triggers a paginated fetch of up to ALL rows (loop fetching 1000 at a time). For eBay with 378k items, this is extremely slow.

**Fix:** Cap the initial store fetch to a single page (e.g., 200 items) with no pagination loop. Users don't need 378k items rendered at once. Add a "Load More" button or infinite scroll for additional items. The cache ref already handles instant re-display on subsequent selections.

**File:** `src/pages/shop/ShopHome.tsx`
- Replace the `while(true)` pagination loop with a single fetch of ~200 items
- Add a "Load More" button to fetch the next page on demand
- Keep the existing `storeProductsCacheRef` for instant re-display

## Issue 3: Amazon Products Show Wrong Image Initially

**Root cause:** When navigating from a product card, `ProductDetails.tsx` line 191 sets `images: [nav.imageUrl]` — this is a thumbnail URL from the card. The hero shows this thumbnail at 800px (blurry/wrong) until the API fetch completes and replaces images. The auto-select logic (lines 318-332) sometimes keeps the old index.

**Fix:** When API data arrives with a real gallery, immediately force `currentImageIndex = 0` to show the first (best) API image, overriding the nav thumbnail. Only preserve user's index if they manually interacted with the gallery.

**File:** `src/pages/shop/ProductDetails.tsx`
- After `setProduct` with API data, always reset `setCurrentImageIndex(0)` when API provides new images (unless user has interacted)
- This ensures the nav thumbnail is instantly replaced by the full-res API image

## Issue 4: Cart Duplicate Bug — Permanent Fix

**Root cause:** The current fix (`setItems(prev => prev.filter(i => i.id !== newItem.id))`) runs before `syncCart()`, but React 18 batches these updates. When `syncCart` runs `setItems(current => ...)`, the `current` may still include the local item because React hasn't flushed the previous `setItems` yet. The merge logic at line 412-418 then preserves it as an "unmatched local optimistic item."

**Fix:** Instead of relying on two separate `setItems` calls coordinating, make `syncCart` itself unconditionally discard ALL `local_` items when server data arrives. The server is the sole source of truth — any `local_` item is just a temporary placeholder and should never survive a sync.

**File:** `src/contexts/ShopCartContext.tsx`
- In `syncCart`, line 412-418: remove the logic that preserves unmatched local_ items. When server responds, use ONLY server items (filtered by deleted IDs). No local_ items should survive a sync.
- Remove the separate `setItems(prev => prev.filter(...))` call in `addItem` since syncCart will handle it

---

## Summary

| File | Change |
|------|--------|
| `src/pages/shop/ShopHome.tsx` | Dynamic store dropdown from DB; cap fetch to 200 items; load-more button |
| `src/pages/shop/ProductDetails.tsx` | Force image index reset when API gallery arrives |
| `src/contexts/ShopCartContext.tsx` | syncCart drops ALL local_ items unconditionally |

