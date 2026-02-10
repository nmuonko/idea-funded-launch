

# Fix Cart Shipping, Delete Race Condition, and Vehicle Display

## Issue 1: Mobile App — Shipping Fee Doesn't Update When Items Are Deselected

**Root Cause**: The `mobile-get-cart` edge function calculates shipping as a SINGLE flat fee for all active regular items combined (line 454-457):
```
regularShippingTotal = shippingBaseFeeUsd + (regularItemsBaseTotal * normalizedShippingPercent)
```
This is correct for the full cart. However, the mobile app's "select/deselect" feature filters items locally but still uses `summary.shippingFeeUsd` from the API which reflects ALL items. The shipping fee doesn't recalculate when items are deselected because the backend has no concept of "selected" items -- all active items are included.

**Fix**: The `mobile-get-cart` response already includes per-item `itemBaseTotalUsd` and the shipping debug info (`shippingBaseFeeUsd`, `normalized_shippingPercent`). The mobile app needs to recalculate shipping locally when items are selected/deselected using the formula:
```
shipping = shippingBaseFeeUsd + (selectedItemsBaseTotal * shippingPercent)
```

Since this is a mobile app issue (React Native, not this web codebase), the fix involves updating the backend to return per-item shipping contributions OR ensuring the mobile app recalculates. We can add a `perItemShipping` field to each active item in `mobile-get-cart` so the mobile app can sum only selected items' shipping.

**File**: `supabase/functions/mobile-get-cart/index.ts`
- For each regular (non-vehicle) active item, calculate and include its individual shipping contribution
- Add `itemShippingUsd` calculated per-item using the same formula: `shippingBaseFeeUsd / activeRegularCount + (itemBaseTotalUsd * normalizedShippingPercent)`
- This way, the mobile app can sum `itemShippingUsd` for selected items only

Alternative simpler approach: Calculate shipping per-item proportionally. Each item's shipping = `(itemBaseTotalUsd / regularItemsBaseTotal) * totalShipping`. This ensures summing all items gives the same total.

## Issue 2: Web App — Deleted Items Reappear When Adding New Item

**Root Cause**: In `ShopCartContext.tsx`, the `removeItem` function (line 390):
1. Calls `setItems(prev => prev.filter(...))` -- removes locally
2. Calls `supabase.functions.invoke('mobile-delete-cart-item')` -- removes on server (async, no await for sync)

Then when `addItem` is called:
1. Adds item locally
2. Calls `supabase.functions.invoke('mobile-add-cart-item')` 
3. Calls `await syncCart()` which fetches ALL items from server

The problem: `removeItem` does NOT await the server deletion completing. If `addItem` triggers `syncCart` before the delete has finished on the server, the old item is still there and gets re-added to local state.

**Fix**: `removeItem` must `await` the server delete call before returning. Additionally, `addItem`'s `syncCart` call may still race. The safest fix is:
1. Make `removeItem` await the server delete
2. In `addItem`, ensure `syncCart` is called only after the server add completes (already the case)
3. Add a guard: after `syncCart` in `addItem`, don't re-add items that were locally removed

**File**: `src/contexts/ShopCartContext.tsx`
- In `removeItem`: await the server delete, then optionally re-sync to confirm
- In `addItem`: the `syncCart` call already awaits, but ensure it doesn't race with pending deletes

## Issue 3: Web App — Vehicle in Cart Should Show Markup but Hide Shipping

**Root Cause**: The cart page (`ShopCart.tsx` line 206-209) renders a single `PriceBreakdown` for the entire cart total without passing `isVehicle`. When a user clicks on a vehicle item in the cart, it navigates to `/product/:provider/:productId` without passing `isVehicle` in the navigation state.

**Fixes**:

### 3a. Cart page PriceBreakdown for vehicles
The cart page should detect if there are vehicle items and pass appropriate flags. Currently it relies on `hasVehicleItems` from context, but doesn't pass `isVehicle` to `PriceBreakdown`. The `PriceBreakdown` already handles the `vehiclePendingQuote` path when `hasVehicleItems && vehicleQuoteStatus !== 'quoted'` -- this should work. Let me verify the cart page passes the right props.

Looking at ShopCart.tsx line 206-209: `PriceBreakdown` is called with only `itemPriceUsd` and `showDetails`. It does NOT pass `isVehicle`. The component reads `hasVehicleItems` and `vehicleQuoteStatus` from context, so the mixed-cart path (line 91-99) should trigger -- showing "Included in quote" for markup and "Awaiting quote" for shipping. But the vehicle-specific markup display (lines 73-88) only triggers when `isVehicle` prop is true.

For a cart with ONLY vehicles, the breakdown should show vehicle markup with correct percentage. For mixed carts, it should show separate breakdowns.

**Fix**: Enhance the cart page to show per-item price breakdown for vehicles, or pass `isVehicle={true}` when all items are vehicles.

### 3b. Vehicle item click in cart should pass state
When clicking a vehicle in cart (ShopCart.tsx line 129-131, 142-144), it links to the product page but doesn't pass `isVehicle` in the Link state.

**Fix**: Pass `isVehicle` in the Link state so ProductDetails picks it up:
```tsx
<Link 
  to={`/product/${item.provider}/${encodeURIComponent(item.productId)}`}
  state={{ product: { isVehicle: item.isVehicle } }}
>
```

### 3c. Request Quote button visibility
The cart page already has a "Request Shipping Quote" button (line 222-239) when `hasVehicleItems && vehicleQuoteStatus !== 'quoted'`. This should already work. Verify it sends admin email notification.

---

## Technical Summary of Changes

| File | Change |
|---|---|
| `supabase/functions/mobile-get-cart/index.ts` | Add per-item shipping calculation for regular items so mobile can recalculate when items are selected/deselected |
| `src/contexts/ShopCartContext.tsx` | Fix `removeItem` to await server delete before resolving; prevent race with subsequent `addItem` sync |
| `src/pages/shop/ShopCart.tsx` | Pass `isVehicle` state in cart item links; pass `isVehicle` to `PriceBreakdown` when cart is all-vehicles |
| `src/components/shop/PriceBreakdown.tsx` | Minor: ensure vehicle-only cart shows vehicle markup percentage correctly |

## No Regressions
- Non-vehicle products unaffected
- Cart total calculations unchanged (per-item shipping sums to same total)
- Mobile app benefits from per-item shipping data without breaking existing summary fields
- Checkout flow unchanged

