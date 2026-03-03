

# Fix Plan: Store Filter Speed, Image Quality, and Cart Duplicates

## Issue 1: Slow Store Filtering on Home Page

**Root cause:** When you select a store on the Home page, `ShopHome.tsx` triggers a full database query (lines 371-462) fetching up to 1000+ rows from `catalog_items` with pagination. This takes several seconds.

**Fix:** Cache store-filtered results in `useState` keyed by provider. Once a store's products are fetched, switching back to it will be instant (no re-fetch). Also add `useMemo`-based client-side filtering of already-loaded category products for immediate results while the DB fetch completes in the background.

**File:** `src/pages/shop/ShopHome.tsx`
- Add a `storeProductsCache` ref (`useRef<Record<string, Product[]>>`) to cache results per provider
- On filter change, check cache first. If cached, display instantly. Still fetch in background to update silently.
- Show cached data immediately, no loading spinner for repeat selections

## Issue 2: Blurry/Late Images on Product Details

**Root cause:** `ProductDetails.tsx` (line 680) uses `resizeImageUrl(url, IMAGE_SIZE_HERO)` where `IMAGE_SIZE_HERO = 800`. For stores like SHEIN, Temu, Walmart etc., the `resizeImageUrl` function in `imageResize.ts` only handles Amazon and eBay URL patterns. For other stores, it returns the URL unchanged — but these URLs may already point to low-res thumbnails (e.g., 200px versions). The product card initially passes a thumbnail URL via navigation state (line 191: `images: nav.imageUrl ? [nav.imageUrl]`), and the full gallery only loads after the API fetch completes.

**Fix:** 
- In `ProductDetails.tsx`, when the product data arrives from the API, prioritize full-res images immediately instead of keeping the nav thumbnail as fallback during the transition
- Add `fetchPriority="high"` and remove the fade-in animation delay for the hero image so it appears faster
- Preload the hero image URL as soon as API data arrives (already partially done but can be improved)

**File:** `src/pages/shop/ProductDetails.tsx`
- When API data arrives with images, immediately replace the hero image (don't wait for animation)
- Set `loading="eager"` (already set) and ensure no unnecessary re-renders delay image display

## Issue 3: Duplicate Cart Items (BUG)

**Root cause:** In `ShopCartContext.tsx`, `addItem` (line 472-516):
1. Creates a local optimistic item with `id: local_xxx` and `productUrl` set to the canonical URL
2. Calls `mobile-add-cart-item` on the server
3. Calls `syncCart()` which fetches items from the server

In `syncCart` (line 412-418), it merges server items with remaining local optimistic items. The dedup uses `canonicalItemKey` which compares URLs after stripping protocol. **But the server may return a different URL format** (e.g., with query params, different path structure) than what `buildServerProductUrl` generated locally. When the keys don't match, both the local item AND the server item appear — creating a duplicate.

**Fix:** After `mobile-add-cart-item` succeeds, remove the local optimistic item before calling `syncCart`, so the server's version is the single source of truth. This eliminates the possibility of key mismatch duplication.

**File:** `src/contexts/ShopCartContext.tsx`
- In `addItem`, after the server call succeeds, remove the local optimistic item from state before calling `syncCart()`
- Alternative approach: in `syncCart`, when server items arrive, unconditionally replace ALL local_ items (not just matching ones). If a local item doesn't match any server item, it's either still being processed or failed — either way, the next sync will reconcile.

### Implementation detail:
```typescript
// In addItem, after successful server call:
setItems(prev => prev.filter(i => i.id !== newItem.id));
syncCart();
```

This ensures the local placeholder is always cleared before the server sync fills in the real item.

---

## Summary of Changes

| File | Change |
|------|--------|
| `src/pages/shop/ShopHome.tsx` | Cache store-filtered products per provider for instant re-display |
| `src/pages/shop/ProductDetails.tsx` | Improve image transition to reduce perceived blurriness |
| `src/contexts/ShopCartContext.tsx` | Fix duplicate by clearing local optimistic item before sync |

