
# Fix Vehicle Markup Alignment and Quote State Feedback

## Problem 1: Markup Fee Mismatch

The admin has configured a **10% markup for vehicles** (`category_markups.vehicles = 10`) and a **30% general markup** (`markup_percent = 30`). However, when a car is added to cart:

- `mobile-add-cart-item` uses the **general 30% markup** because its settings helper (`_shared/cart/db.ts`) does not fetch `category_markups` from the database at all
- `mobile-get-cart` correctly uses the **10% vehicle markup** (via `_shared/settings-cache.ts` which reads `category_markups`)
- This causes the mobile app to show inconsistent pricing between add-to-cart response and cart view

### Fix

**File: `supabase/functions/_shared/cart/db.ts`**
- Add `category_markups` to the SELECT query in `getCachedSettings`
- Add `vehicleMarkupPercent` to the returned `CartSettings` object, extracted from `category_markups.vehicles` (defaulting to general markup)

**File: `supabase/functions/_shared/cart/pricing.ts`**
- No changes needed -- `calculateItemPricing` already accepts a markup parameter; callers just need to pass the correct one

**File: `supabase/functions/mobile-add-cart-item/index.ts`**
- When a vehicle is detected (`isVehicle = true`), use `settings.vehicleMarkupPercent` instead of `settings.markupPercent` for pricing calculation

## Problem 2: Quote State Update After Clicking "Request a Quote"

The flow is: user clicks button -> calls `mobile-request-quote` -> `syncCart()` re-fetches cart -> state updates. This already works correctly after the earlier `NONE`/`pending` fix, but there may be a brief delay where the button is still visible.

### Fix

**File: `src/pages/shop/ShopCart.tsx`**
- After a successful quote request, **optimistically set** `vehicleQuoteStatus` to `'pending'` immediately (before `syncCart` completes) so the UI transitions instantly from the amber button to the "Quote Pending" status bar
- This requires exposing a `setVehicleQuoteStatus` setter or adding a helper method in the cart context

**File: `src/contexts/ShopCartContext.tsx`**
- Expose a `markQuoteRequested` helper function that sets `vehicleQuoteStatus = 'pending'` immediately
- The subsequent `syncCart()` call will confirm the state from the server

## Technical Details

### Files Modified
1. `supabase/functions/_shared/cart/db.ts` -- Add `category_markups` to settings query and return `vehicleMarkupPercent`
2. `supabase/functions/mobile-add-cart-item/index.ts` -- Use vehicle-specific markup when `isVehicle` is detected
3. `src/contexts/ShopCartContext.tsx` -- Add `markQuoteRequested()` helper for optimistic state update
4. `src/pages/shop/ShopCart.tsx` -- Call `markQuoteRequested()` immediately on successful quote request for instant UI feedback

### Edge Functions Redeployed
- `mobile-add-cart-item` (markup fix)

### No database changes needed
The `category_markups` column already exists in `settings` with the correct value (`vehicles: 10`).
