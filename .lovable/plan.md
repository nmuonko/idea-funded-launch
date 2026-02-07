
# Vehicle Quote Workflow for Web + Price Conflict Fix

## Problem Summary
Two issues need fixing:

1. **Missing Vehicle Quote Flow on Web**: When a user adds a car/vehicle to their cart on the web app, they can proceed directly to checkout and payment -- but the backend will reject the payment because vehicles require a manual shipping quote from the admin first. The mobile app already handles this correctly (shows "Request Quote" instead of "Checkout"), but the web app has no such logic.

2. **Price Conflict on Payment Page**: The cart/checkout page shows an "Estimated Total" calculated locally by the frontend (using `PriceBreakdown.tsx` with client-side fee settings), but when the user reaches the payment page (Card or Mobile Money), it shows a different amount calculated by the backend. These amounts diverge because the backend may use different markup rates (especially for vehicles with `vehicleMarkupPercent`) or the quoted price from the admin.

## Solution

### Part 1: Expose Vehicle Flags from Backend to Web Cart

**File: `src/contexts/ShopCartContext.tsx`**

- Add new fields to `CartItem` interface: `isVehicle?: boolean`, `requiresManualQuote?: boolean`, `vehicleQuoteApplied?: boolean`
- Add new state variables: `hasVehicleItems`, `vehicleQuoteStatus` (`'none' | 'pending' | 'quoted'`), `canProceedToPayment`
- In `syncCart()`, when mapping items from `mobile-get-cart` response, include the vehicle flags from each item
- Store and expose the summary-level flags (`hasVehicleItems`, `vehicleQuoteStatus`, `canProceedToPayment`) from the `mobile-get-cart` response's `summary` object
- Also store `serverTotalUsd` from the backend response (the authoritative total) for use in checkout

### Part 2: Cart Page -- Show "Request Quote" for Vehicle Items

**File: `src/pages/shop/ShopCart.tsx`**

- Import vehicle detection flags from `useShopCart()`
- For each cart item, if `item.isVehicle` is true, show a badge like "Vehicle -- Quote Required"
- Replace the "Proceed to Checkout" button logic:
  - If `hasVehicleItems && vehicleQuoteStatus === 'pending'`: Show a "Request Shipping Quote" button that calls the `request-vehicle-quote` edge function
  - If `hasVehicleItems && vehicleQuoteStatus === 'quoted'`: Show normal "Proceed to Checkout"
  - If no vehicles: Show normal "Proceed to Checkout"
- After requesting a quote, show a success message: "Quote requested! We'll notify you by email when your shipping quote is ready."

### Part 3: Checkout Page -- Block Checkout for Pending Vehicles

**File: `src/pages/shop/Checkout.tsx`**

- Read `canProceedToPayment` and `vehicleQuoteStatus` from cart context
- If `canProceedToPayment === false`, show a blocking message instead of the checkout form, directing the user to request a quote from the cart page
- This is a safety guard in case the user navigates directly to `/checkout`

### Part 4: Fix Price Conflict -- Use Server-Calculated Total

**File: `src/components/shop/PriceBreakdown.tsx`**

- Add an optional prop `serverTotal?: number` to `PriceBreakdown`
- When `serverTotal` is provided, display it as the final total instead of the locally calculated estimate
- Still show the item subtotal, but label the total as "Total" (not "Estimated Total") when server-provided

**File: `src/pages/shop/Checkout.tsx`**

- After calling `mobile-create-order-from-cart` (Step 1), the backend returns the authoritative order total
- Store this server total in state
- Pass it to `PriceBreakdown` via the new `serverTotal` prop
- When redirecting to card payment or payment-pending, use the server-provided amount (already done for card via `providerData.amount`, but ensure consistency)
- The `savePendingCheckout` call should use the server total, not the client `totalUsd`

**File: `src/pages/shop/CardPayment.tsx`**

- No changes needed -- it already reads `amount` from URL params which comes from the backend

### Part 5: Vehicle Quote Request Function Call

**File: `src/pages/shop/ShopCart.tsx`** (continued)

- Add a `requestVehicleQuote` async function that:
  1. Calls `supabase.functions.invoke('request-vehicle-quote')` (or `mobile-request-quote`)
  2. On success, shows a toast notification
  3. Re-syncs the cart to update `vehicleQuoteStatus`
- The button should show a loading state while the request is in progress

## Files to Modify

1. **`src/contexts/ShopCartContext.tsx`** -- Add vehicle flags, server total, and `canProceedToPayment` to context
2. **`src/pages/shop/ShopCart.tsx`** -- Vehicle badge, conditional "Request Quote" button
3. **`src/pages/shop/Checkout.tsx`** -- Block checkout for pending vehicles, use server total for price display
4. **`src/components/shop/PriceBreakdown.tsx`** -- Accept optional `serverTotal` prop to eliminate price conflicts

## No Backend Changes Required

The backend already:
- Detects vehicles in `mobile-add-cart-item` and sets `is_vehicle = true`
- Returns vehicle flags in `mobile-get-cart` response (`hasVehicleItems`, `vehicleQuoteStatus`, `canProceedToPayment`)
- Has `request-vehicle-quote` / `mobile-request-quote` edge functions ready
- Blocks checkout for unquoted vehicles in `mobile-checkout` via `vehiclePaymentGuard`
- Returns the authoritative total in `mobile-create-order-from-cart` and `mobile-checkout` responses

All changes are frontend-only, wiring the existing backend capabilities to the web UI.
