

# Vehicle Sliding-Percentage Pricing Model (USA → Dar es Salaam)

## Summary

Replace the manual "Request a Quote" flow for vehicles with an auto-calculated tiered pricing model. The total percentage (tier + surcharges) is applied to the base vehicle price. All tier values and surcharges are admin-configurable with the specified defaults.

## How it works

```text
final_price_usd = base_vehicle_price_usd × (1 + total_percentage / 100)

total_percentage = tier_percentage + condition_surcharge + shipping_method_surcharge

Example: $10,000 car, running, RORO
  tier = 48%  (falls in $8,000–$11,999 bracket)
  condition = 0%  (running = default)
  shipping = 0%  (roro = default)
  total = 48%
  final = $10,000 × 1.48 = $14,800
```

## Database changes

### Migration: Add `vehicle_pricing_tiers` JSONB column to `settings`

A single new JSONB column on the existing `settings` table stores all vehicle tier config:

```json
{
  "tier_1_under_5000_percent": 70,
  "tier_2_5000_to_7999_percent": 58,
  "tier_3_8000_to_11999_percent": 48,
  "tier_4_12000_to_17999_percent": 40,
  "tier_5_18000_to_24999_percent": 34,
  "tier_6_25000_plus_percent": 28,
  "non_running_extra_percent": 7,
  "container_extra_percent": 8,
  "default_shipping_method": "roro",
  "default_vehicle_condition": "running"
}
```

One JSONB column is cleaner than 10 separate columns — easy to extend later (e.g., DRC customs layer).

## Backend changes

### 1. New shared helper: `supabase/functions/_shared/vehiclePricing.ts`

Pure function module with:

- `getVehicleTierPercent(basePriceUsd, tiers)` — returns the tier % based on price brackets
- `calculateVehicleTotalPercent(basePriceUsd, condition, shippingMethod, tiers)` — returns `{ tierPercent, conditionSurcharge, shippingSurcharge, totalPercent }`
- `calculateVehicleFinalPrice(basePriceUsd, condition, shippingMethod, tiers)` — returns `{ basePriceUsd, tierPercent, conditionSurcharge, shippingSurcharge, totalPercent, finalPriceUsd }`
- All inputs typed, all defaults safe (missing tiers → 0)
- Structured for a future DRC layer to apply on top

### 2. Update `settings-cache.ts`

Add `vehiclePricingTiers` to `CachedSettings` interface and fetch from the new JSONB column.

### 3. Update `_shared/cart/db.ts`

Add `vehiclePricingTiers` to `CartSettings` interface.

### 4. Update `mobile-cart/index.ts` — `handleAddItem`

When `isVehicleDetected = true`:
- Call `calculateVehicleFinalPrice(productPrice, 'running', 'roro', settings.vehiclePricingTiers)` using defaults
- Store computed fields: `markup_fee_usd` = finalPrice - basePriceUsd, `shipping_fee_usd` = 0 (shipping is baked into the percentage), `total_price_usd` = finalPriceUsd
- Set `vehicle_quote_applied = true`, `price_source = 'auto_vehicle_tiered'`
- Remove `requiresManualQuote = true` — vehicles now proceed directly

### 5. Update `mobile-cart/index.ts` — `formatItem`

For `isVehicle && !vehicleQuoteApplied` (legacy items without auto-pricing):
- Auto-calculate using tier pricing instead of showing "PENDING" shipping
- This handles items added before this change

### 6. Update `mobile-checkout` and `mobile-create-payment`

- Remove the block that rejects vehicles without `vehicle_quote_applied` (since all vehicles now auto-price)
- Keep the existing path for `vehicle_quote_applied === true` items (backward compatible)

### 7. Expose tiers via `mobile-public-config`

Add `vehiclePricingTiers` to the public config response so both web and RN frontends can compute the same display price.

## Frontend changes

### 8. New utility: `src/lib/vehiclePricing.ts`

Mirror of the backend helper — same pure functions, same logic. Used for display-only calculations on product cards and cart views.

### 9. Update `src/lib/allInclusivePrice.ts`

Add a `vehicleAllInclusivePrice(basePriceUsd, tiers, condition?, shippingMethod?)` export that uses the vehicle pricing utility.

### 10. Update `ShopCart.tsx`

- Remove the "Request a Quote" / "Demander un devis" button and all quote-pending UI states
- Vehicle items display the auto-calculated final price with "Fees included" label
- Remove `requestVehicleQuote` function and related state

### 11. Update `PasteBreakdownCard.tsx`

- Remove "Request a Quote" button for vehicles
- Show single final price for customer view
- In admin view: show full breakdown (base, tier %, condition surcharge, shipping surcharge, total %, final price)

### 12. Update `PriceBreakdown.tsx`

- Vehicle items show simplified "Total (fees included)" for customers
- Admin view shows the tier breakdown

### 13. Update `ProductCard.tsx`

- For vehicle items, use `vehicleAllInclusivePrice()` to show the final price on the card

### 14. Admin UI: Update `FeesSettings.tsx`

Add a new **"Vehicle Pricing Tiers (USA → Dar es Salaam)"** card section with:
- 6 tier percentage inputs (with price range labels)
- Non-running surcharge input
- Container surcharge input
- Default shipping method selector (RORO / Container)
- Default vehicle condition selector (Running / Non-running)
- Example calculation showing a sample vehicle price through the formula
- Clear note: "This covers USA → Dar es Salaam only. DRC customs/inland delivery is a separate layer."

All values saved to `settings.vehicle_pricing_tiers` JSONB.

## What stays unchanged

- Regular product pricing (all-inclusive via existing `allInclusivePrice`)
- Hot product pricing
- Admin Quote Requests page (kept for manual overrides — admin can still override any auto-calculated price)
- Checkout and payment flows (vehicles with `vehicle_quote_applied = true` already work)
- `request-vehicle-quote` edge function (kept but no longer triggered by default)
- Exchange rate display
- All existing API contracts

## Extensibility for DRC layer

The code is structured so a future DRC customs/inland layer can be applied as:
```text
final_delivered_price = usa_to_dar_final × (1 + drc_layer_percent / 100) + drc_fixed_fees
```
The vehicle pricing helper returns an intermediate result that a DRC module can consume.

