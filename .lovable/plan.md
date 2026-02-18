

# Fix Plan: 5 Critical Web App Issues

## Issue 1: Missing "Size" Variant Option

**Root Cause**: The variant data flows correctly from the `catalog-product` endpoint through `product_variants_cache` to the frontend. The `variantGroups` logic in `ProductDetails.tsx` (lines 136-156) correctly groups by dimension name (Color, Size, Model, etc.). The issue is that Size data depends on the Rainforest API returning `dimensions` arrays that include a `Size` entry. If the product's variant cache was populated before Size data was available, or the API response doesn't include Size, it won't show.

**Fix**: The code path is correct -- the issue is **data-level**. However, we can add resilience by also checking for eBay-style `aspects` or Rainforest `variation_values` fields. The `catalog-product/index.ts` `mapDbItemToResponse` function (line 268-285) only extracts variants from `raw.variants`. If the Rainforest API returns size info in a different structure (e.g., `raw.variation_values`), it's being ignored.

**Changes**:
- `supabase/functions/catalog-product/index.ts`: In `mapDbItemToResponse`, also check `raw.variation_values` and `raw.variants_v2` as fallback sources for variant dimensions (specifically Size).
- Add a log to help debug which products are missing Size data.

---

## Issue 2: Payment Failures (Mobile Money + Card)

**Root Cause**: Two distinct problems:

**A) Large orders (vehicles, >$3000 USD)**: The `mobile-checkout` function returns `payment_flow: 'CHOICE_REQUIRED'` with `status: 'choice_required'` for large orders. But the frontend `Checkout.tsx` only checks for `status === 'awaiting_provider_selection'` (line 229). The `CHOICE_REQUIRED` flow falls through to the legacy handler at line 319, which navigates to `/payment-callback?session_id=...`. The `PaymentCallback` page only handles pawaPay (checks `provider !== "pawapay"` at line 131), so it immediately fails with "Invalid payment callback parameters".

**B) Standard orders**: The `mobile-checkout` returns `status: 'awaiting_provider_selection'` correctly and calls `select-payment-provider`. The select-payment-provider function then calls PawaPay or Stripe. Based on the production logs, PawaPay is correctly creating deposits. The "Edge Function returned a non-2xx status code" error shown in the screenshot could be from `select-payment-provider` throwing an unhandled error or from the `checkout_sessions` table being in the wrong state.

**Fix**:
- `src/pages/shop/Checkout.tsx`: Add handling for `payment_flow === 'CHOICE_REQUIRED'` or `status === 'choice_required'` responses. When this is detected, use the `checkout_session_id` to proceed to `select-payment-provider` just like the standard flow (the checkout session ID is valid in both cases).

Specifically, change line 229 from:
```
if (data?.status === 'awaiting_provider_selection' && data?.checkout_session_id) {
```
to:
```
if ((data?.status === 'awaiting_provider_selection' || data?.payment_flow === 'CHOICE_REQUIRED') && data?.checkout_session_id) {
```

This makes the frontend handle both standard and large-order checkout responses identically -- both proceed to `select-payment-provider`.

---

## Issue 3: Cars Not Asking for Quotes

**Root Cause**: From the screenshot, the BMW X5 shows "Proceder au paiement (1)" instead of "Request a Quote". In `ShopCart.tsx`, the quote button shows only when `item.isVehicle && vehicleQuoteStatus === 'none'` (line 245). The `isVehicle` flag comes from the server via `mobile-get-cart`, which reads `order_items.is_vehicle`. But the `mobile-add-cart-item` function may not be setting `is_vehicle = true` for this car.

Additionally, the car in the screenshot shows shipping fee ($1378.50), but per the vehicle guardrails spec, vehicle items should NOT show shipping estimates -- they need manual quotes.

**Fix**:
- Check the `mobile-add-cart-item` edge function to ensure it detects vehicles (using `looksLikeVehicleListing` or category checks) and sets `is_vehicle = true` on the `order_items` row.
- If the detection logic is missing or broken, add/fix it so BMW, Toyota, etc. listings are flagged as vehicles at cart-add time.

**File**: `supabase/functions/mobile-add-cart-item/index.ts` -- needs investigation and likely a fix to vehicle detection.

---

## Issue 4: Empty "Mes commandes" (My Orders)

**Root Cause**: The database confirms orders exist for this user (PENDING_PAYMENT and PAID statuses). The RLS policies allow authenticated users to read their own orders. However, two issues:

1. **Sign-in link goes to admin portal**: `MyOrders.tsx` line 152 links unauthenticated users to `/auth` (admin login) instead of `/shop-auth` (customer login). If the user isn't logged in via the shop auth, they see the "sign in" prompt which takes them to the wrong place.

2. **The user may be viewing from the published site** (`afrishop-usa.com`) where the auth session might differ from the test environment. The orders exist in the production database, and the RLS should work. If the user IS authenticated, the query should return results.

**Fix**:
- `src/pages/shop/MyOrders.tsx` line 152: Change `/auth` to `/shop-auth` so customers are directed to the correct login page.
- Verify the query works for authenticated shop users (it should, based on the RLS policies).

---

## Issue 5: Cart Item Duplication After Delete + Add

**Root Cause**: In `ShopCartContext.tsx`, when a user deletes an item then adds a new one:

1. `removeItem` sets the deleted ID in `deletedItemIdsRef` and removes it from local state.
2. `removeItem` calls `syncCart()` after server deletion.
3. Meanwhile, `addItem` creates a `local_` item optimistically and also calls `syncCart()`.
4. The `syncCart` lock (`syncInProgressRef`) queues the second sync.
5. When the queued sync runs, the server now has the newly added item. But the `addItem` function's duplicate check (line 410) uses `productId` -- however, after `removeItem`, the item is gone from `items`, so the check doesn't find it. But the server may process the add-cart request while the first `syncCart` is still running, causing `syncCart` to bring back the old item AND show the new `local_` one.

The issue is a timing race: `addItem` creates a local item AND triggers server add + syncCart. If two syncs happen in quick succession, the optimistic local item persists alongside the server-confirmed item because `cartKey` matching doesn't account for the timing.

**Fix**:
- In `ShopCartContext.tsx`, enhance the `syncCart` merge logic to deduplicate by `cartKey` (provider + productId). When merging server items with local optimistic items, if a server item matches a local item's `cartKey`, drop the local one (the server version takes priority).

Currently (line 362-367):
```typescript
const localOptimistic = (current ?? [])
  .filter(it => isLocalId(it.id))
  .filter(it => !serverKeys.has(cartKey(it)));
```

This already filters locals that match server keys. The bug might be that `productId` in the local item differs from the server's `productUrl` used as `productId`. In `syncCart`, the server item's `productId` is set to `item.productUrl || item.product_url` (line 337), but in `addItem`, the local item's `productId` is the raw product ID (e.g., ASIN). So `cartKey` uses different values, and the duplicate isn't detected.

**Fix**: Normalize the `cartKey` function to also match on `productUrl` when available, or use a consistent identifier. In `addItem`, also set `productUrl` on the local item so it can be matched during sync.

---

## Summary of File Changes

| File | Changes |
|------|---------|
| `src/pages/shop/Checkout.tsx` | Add `CHOICE_REQUIRED` handling (line 229) |
| `src/pages/shop/MyOrders.tsx` | Fix sign-in link from `/auth` to `/shop-auth` (line 152) |
| `src/contexts/ShopCartContext.tsx` | Fix cart dedup: normalize cartKey using productUrl; set productUrl on local items in addItem |
| `supabase/functions/mobile-add-cart-item/index.ts` | Investigate and fix vehicle detection for cars |
| `supabase/functions/catalog-product/index.ts` | Add fallback variant extraction for Size dimensions |

