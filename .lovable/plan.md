

# Show All-Inclusive Prices Everywhere (No Surprises)

## Problem
Currently, product cards, cart drawer, and cart page show the **base price** (`priceUsd`). Customers only see the real total (with markup + shipping) on the checkout breakdown — causing surprise.

## Goal
Display a single all-inclusive price (base + markup + shipping) everywhere a price appears. The price on the product card = the price in cart = the price at checkout. Vehicles/heavy items are excluded (handled separately later).

## Approach — Compute "display price" from fee settings

Create a utility function that takes a base price and fee settings, and returns the all-inclusive price. Use it everywhere prices are displayed.

### Step 1 — New utility: `src/lib/allInclusivePrice.ts`

A simple function:
```
allInclusivePrice(basePriceUsd, feeSettings) =
  basePriceUsd + (basePriceUsd × markupPercent/100) + shippingFee(basePriceUsd)
```
Uses the existing `calculateShippingUsd` from `shippingCalculation.ts`. Returns the final price. All values from admin settings (not hardcoded).

### Step 2 — Update `ProductCard.tsx`

Replace `product.priceUsd` display with `allInclusivePrice(product.priceUsd, feeSettings)`. Both the USD and CDF displays. The `feeSettings` and `exchangeRate` are already available via `useShopCart()`.

### Step 3 — Update `CartDrawer.tsx`

Replace `item.priceUsd` display with the all-inclusive price for each item. Update the footer subtotal to use all-inclusive prices too.

### Step 4 — Update `ShopCart.tsx` (cart page)

Replace `item.priceUsd` display with the all-inclusive price.

### Step 5 — Update `PriceBreakdown.tsx`

For **non-vehicle, non-fixed-price** items: instead of showing the breakdown (item / markup / shipping / total), show a simplified view similar to hot products — one total price with "Fees included" label. The total itself remains the same calculation.

### Step 6 — Update `PasteBreakdownCard.tsx`

Replace the line-by-line breakdown (base, service fee, shipping) with a single all-inclusive total. Keep the vehicle logic unchanged.

### Step 7 — Update `MiniCartPreview.tsx`

Replace `item.priceUsd * item.quantity` with all-inclusive price × quantity.

## What does NOT change
- Backend pricing logic (edge functions, order totals) — unchanged
- Vehicle/heavy item pricing — excluded, handled later  
- Hot product pricing — already all-inclusive, unchanged
- Admin settings — no new fields needed
- `addItem` still sends `basePriceUsd` to the backend — the display-only wrapper is frontend-only

## Key detail
The `priceUsd` field in `CartItem` stays as the base price internally. The all-inclusive price is computed on-the-fly for display using admin fee settings. This keeps backend compatibility intact.

