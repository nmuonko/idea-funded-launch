

# Fix Price Mismatch Between Product Display and Cart in RN App

## Problem
The RN app shows a product at **$399** (base price from `catalog-home`), but when added to cart, the backend applies markup (30%) + shipping on top, inflating it to **$558.70**. The customer sees one price, pays another -- a trust-breaking experience.

## Root Cause
- `catalog-home` returns raw base prices (`price_usd: 399`)
- The frozen RN app displays this raw price as-is on product cards
- When adding to cart, the RN app sends `productPrice: 399`
- The cart backend (`handleAddItem`) treats this as a base price and stacks markup + shipping on top
- Result: display = $399, cart = $558.70

## Solution: Two-Part Backend Fix

### Part 1 — Make `catalog-home` return all-inclusive prices

Modify `catalog-home/index.ts` to compute and return the all-inclusive price in the `price_usd` and `priceUsd` fields. This way the frozen RN app displays the final price the customer will actually pay.

- Load settings (markup_percent, shipping_base_fee_usd, shipping_percent) once per request
- For each non-vehicle product item, compute: `allInclusivePrice = base + (base * markup%) + shippingBaseFee + (base * shipping%)`
- For vehicles, use the tiered vehicle pricing calculation
- Return the all-inclusive value in `price_usd` / `priceUsd` (what the RN app reads)
- Also return `base_price_usd` with the original raw price for internal use
- Add `fees_included: true` and `pricing_mode: "all_inclusive"` metadata

### Part 2 — Make cart addition recognize all-inclusive prices

Modify `handleAddItem` in `mobile-cart/index.ts` to detect when the incoming price is already all-inclusive and skip double-taxing:

- Accept a new optional flag `feesIncluded` / `fees_included` in the add-to-cart payload
- When `feesIncluded === true`, treat the incoming `productPrice` as the final price:
  - Set `effectiveMarkup = 0`
  - Set `shippingFeeUsd = 0`
  - Store the price as-is in `total_price_usd`
  - Set `price_source = "all_inclusive_display"`
- The frozen RN app won't send this flag, so we need a **fallback heuristic**: if the product was recently served by `catalog-home` with all-inclusive pricing, detect it by reverse-checking the price against the base price in `products` table -- BUT this is fragile
- **Better approach for frozen app**: Since we can't change the RN app, we reverse-compute the base price from the all-inclusive price sent by the app:
  - `basePrice = (sentPrice - shippingBaseFee) / (1 + markupRate + shippingRate)`
  - Then apply fees normally from the true base price, arriving back at the same total the customer saw

### Recommended Approach (simplest, no RN changes needed)

Since the RN app sends whatever `price_usd` it received from `catalog-home`, and we're changing `catalog-home` to send all-inclusive prices:

1. **`catalog-home`**: Return all-inclusive price in `price_usd` (display field) AND add `base_price_usd` with the raw price
2. **`handleAddItem`**: Reverse-extract the base price from the all-inclusive price the RN app sends, then apply fees normally -- resulting in the same total

Actually, the cleanest approach:
1. **`catalog-home`**: Send all-inclusive in `price_usd`, keep raw in `base_price_usd`
2. **`handleAddItem`**: Simply treat the incoming `productPrice` AS the final total (set markup=0, shipping=0) — store it directly as `total_price_usd`. The fees are already baked in.

This means cart items from all-inclusive sources will have `markup_fee_usd = 0` and `shipping_fee_usd = 0` in the DB, with the full amount in `total_price_usd`. This is consistent with the `isFixedPrice` pattern already used for Hot Products.

## Files to Change

1. **`supabase/functions/catalog-home/index.ts`**
   - Load pricing settings (markup, shipping) at request time
   - Compute all-inclusive price for each item in mapping functions
   - Return in `price_usd` / `priceUsd` fields
   - Add `base_price_usd` and `fees_included: true` metadata

2. **`supabase/functions/mobile-cart/index.ts`**
   - In `handleAddItem`: auto-detect when the sent price matches an all-inclusive pattern (price is too high relative to what the raw product costs), OR simply always treat `productPrice` from non-vehicle, non-hot-product sources as all-inclusive
   - Safest: check if the product exists in `products` table, compare sent price vs stored `price_usd`. If sent price > stored base * 1.1, it's all-inclusive — use it as final total

3. **`supabase/functions/catalog-search/index.ts`** (if applicable)
   - Same all-inclusive price transformation for search results consumed by RN app

## What Stays the Same
- Hot Products flow (already uses `isFixedPrice`)
- Vehicle pricing (already uses tiered calculation)
- Web app (already computes all-inclusive client-side via `allInclusivePrice.ts`)
- Order totals recalculation at checkout

## Risk Mitigation
- The web app already computes its own all-inclusive display prices client-side, so changing `catalog-home` response won't break it (web ignores `price_usd` from catalog-home for display)
- Cart DB fields remain consistent: `total_price_usd` is the final amount regardless of how it was computed

