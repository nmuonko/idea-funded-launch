
# Fix Multiple Web App Issues

This plan addresses all reported issues without modifying mobile frontend code.

---

## Issue 1: Kevin Kimo Platform Shows "Web" Instead of "Mobile"

**Root Cause**: The fix we deployed to `auth-register` works for NEW signups only. Kevin Kimo registered BEFORE the fix was deployed, so his profile still has `signup_platform = 'web'` in the database.

**Fix**: Run a one-time data correction. Since we cannot retroactively determine which existing users signed up via mobile from the current data, we need you to manually identify Kevin Kimo's user ID. We will update his profile record directly. Additionally, we will add more logging to the auth-register function so future detections can be verified.

**Files**: No code change needed -- we will run a DB update for Kevin Kimo's profile.

---

## Issue 2: Blank Black Screen When Clicking Some Products After Search

**Root Cause**: When navigating to a product from search, the `ProductCard` passes product data via React Router `state`. However, if the product ID contains the `rainforest_` prefix and the provider is `rainforest`, the `ProductDetails` page tries to fetch from `catalog-product` with a provider that might not match what the backend expects. The page shows `min-h-screen bg-black` with a small red error message that looks like a "blank black screen."

Additionally, when `location.state.product` is missing (e.g., direct URL access or state lost during navigation), the page shows a loading skeleton then immediately jumps to the error state.

**Fix** (in `ProductDetails.tsx`):
- Normalize the provider from `rainforest` to `amazon` earlier in the state initialization (line 82-101), not just in the fetch URL.
- When the fetch fails but navigation state had a product, keep showing the navigation state product instead of the error screen.
- Add a retry mechanism: if `catalog-product` returns an error, retry once after 1 second.

---

## Issue 3: Replace "Rainforest" with "Amazon" Everywhere (Frontend)

**Root Cause**: Multiple frontend files still reference `rainforest` as a provider name in display logic and comparisons.

**Fix** (4 files in `src/`):
| File | Change |
|------|--------|
| `src/components/shop/ProductCard.tsx` | Normalize provider checks to only compare against `amazon`, remove `rainforest` string comparisons, simplify display logic |
| `src/pages/shop/ProductDetails.tsx` | Same normalization -- ensure `rainforest` never appears in UI badges |
| `src/components/admin/CircuitBreakerStatus.tsx` | Change the key label from `rainforest` to reference Amazon properly |
| `src/contexts/ShopCartContext.tsx` | Normalize `rainforest_` prefix handling |

**Note**: Backend edge functions use `rainforest` as an internal provider key for the Rainforest API. That is the technical API name and must NOT be changed in the backend -- only the display label shown to users in the frontend and admin portal needs normalization.

---

## Issue 4: Slow Search Results and Missing Product Options (Colors, Sizes)

**Root Cause**: 
- Search fetches `limit: 100` items per request which is unnecessarily large for initial display, slowing down Time-To-First-Result.
- Product details page does not display product variants (color, size) because `catalog-product` may return variant data but the UI never renders it.

**Fix**:
- `SearchResults.tsx`: Reduce initial fetch limit from 100 to 30 for faster first paint. The infinite scroll will load more pages.
- `ProductDetails.tsx`: Parse and display product variants (colors, sizes) from the `catalog-product` response if available (the `item.variants` or `item.buybox_winner.variant` fields from Rainforest API). Add variant selector UI with color swatches and size buttons that update the displayed price.

---

## Issue 5: Vehicle Checkout Not Properly Blocked + Shipping Shows in Cart

**Root Cause**: The cart `PriceBreakdown` component at line 265 of `ShopCart.tsx` uses `isVehicle={selectedItems.every(i => i.isVehicle)}` -- this means if even ONE non-vehicle item is alongside a vehicle in the selection, `isVehicle` becomes `false`, and shipping fees are shown for everything including the vehicle.

**Fix** (in `ShopCart.tsx`):
- Change `PriceBreakdown` to pass `isVehicle={selectedHasVehicleItems}` instead of the `every()` check. This ensures whenever ANY selected item is a vehicle, shipping shows "Awaiting quote."
- Also ensure the checkout button is properly disabled when vehicle items are selected and quote status is not 'quoted'. Currently `selectedCanProceedToPayment` handles this, but we need to verify the vehicle detection from the server (`is_vehicle` flag on order items).

---

## Issue 6: Deleted Cart Items Reappear

**Root Cause**: The `deletedItemIdsRef` fix was implemented but there may be a timing issue: if `syncCart()` is called by ANOTHER trigger (e.g., auto-quote request at line 337-350 calls `syncCart` indirectly through state changes), the deleted IDs ref might have already been cleared.

**Fix** (in `ShopCartContext.tsx`):
- Keep deleted IDs in the ref for a longer duration (don't clear immediately after the first sync -- keep them for 30 seconds to survive multiple sync cycles).
- Add a timestamp to each deleted ID and only clear entries older than 30 seconds.
- Ensure that the `useEffect` that triggers `syncCart` on user login doesn't race with a delete operation.

---

## Issue 7: Search Speed Optimization

**Fix**:
- Reduce the initial search limit from 100 to 30 items (faster network response).
- Use the existing `cachedCatalogFetch` with aggressive client-side caching -- search results are already cached, but `skipCache: pageNum > 1` only affects pagination. For the same query repeated, cache is used.
- Add `AbortController` to cancel in-flight requests when the user types a new query, preventing stale slow responses from blocking fresh results.

---

## Summary of Files to Modify

| File | Changes |
|------|---------|
| `src/pages/shop/ProductDetails.tsx` | Fix blank screen (keep nav state on error), normalize rainforest to amazon, add variant display (colors/sizes), retry on fetch failure |
| `src/pages/shop/SearchResults.tsx` | Reduce limit 100 to 30, add AbortController for faster search |
| `src/components/shop/ProductCard.tsx` | Remove rainforest string checks, normalize to amazon |
| `src/contexts/ShopCartContext.tsx` | Improve deletedItemIdsRef timing (30s TTL), normalize rainforest references |
| `src/pages/shop/ShopCart.tsx` | Fix PriceBreakdown isVehicle prop to use `selectedHasVehicleItems` |
| `src/components/admin/CircuitBreakerStatus.tsx` | Rename rainforest label |

No backend edge function changes needed. No new dependencies.
