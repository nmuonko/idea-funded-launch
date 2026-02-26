
Goal: make vehicle markup shown in the React Native cart strictly follow the admin vehicle percentage (without touching payment flow).

What I confirmed first
- Backend calculations are already correct in runtime:
  - `mobile-get-cart` logs show `basePriceUsd: 16480` → `estimatedMargin: 1648` (10%).
  - `mobile-public-config` logs show `markupPercent: 20` and `vehicleMarkupPercent: 10`.
- So the issue is most likely response-contract mismatch in mobile UI usage (client likely falling back to generic 20% when expected per-item fields are missing).

Implementation plan (no payment flow changes)
1) Harden `mobile-get-cart` response with backward-compatible per-item aliases
- File: `supabase/functions/mobile-get-cart/index.ts`
- In all 3 item return branches (vehicle quoted, vehicle pending, regular):
  - Keep existing fields.
  - Add compatibility fields that many mobile clients expect:
    - `markupFeeUsd` and `markup_fee_usd` (from authoritative `itemMarginUsd`)
    - `shippingFeeUsd` and `shipping_fee_usd` (from authoritative item shipping)
    - `subtotalUsd` and `subtotal_usd`
    - `totalPriceUsd`, `total_price_usd`, `lineTotalUsd`, `lineTotalCdf`
    - `priceUsd` (authoritative display total for that item line)
    - `markupPercent` (item-level effective percent: vehicle=vehicle markup, regular=general markup)
- Why: this removes any need for client-side recomputation and supports older field naming used by mobile apps.

2) Add cart-level compatibility + effective markup semantics
- File: `supabase/functions/mobile-get-cart/index.ts`
- In top-level response:
  - Add `items: activeItems` alias (legacy compatibility).
- In `summary`:
  - Keep existing totals (`markupFeeUsd`, `totalUsd`, etc.) unchanged.
  - Add explicit metadata:
    - `generalMarkupPercent` (admin general rate)
    - `vehicleMarkupPercent`
    - `effectiveMarkupPercent` (vehicle rate when cart is vehicle-only, else general rate)
  - Keep `markupPercent` for compatibility, but set it to `effectiveMarkupPercent` so vehicle-only carts won’t default to 20% in older clients.
- Why: older clients often read one cart-level markup field; this makes vehicle-only carts compliant immediately.

3) Ensure add-to-cart immediate response also carries compatible markup fields
- Files:
  - `supabase/functions/_shared/cart/pricing.ts`
  - `supabase/functions/mobile-add-cart-item/index.ts`
- Extend add-item response payload to include:
  - `markupFeeUsd` alias, `shippingFeeUsd`, `lineTotalUsd`, and `markupPercent`/`effectiveMarkupPercent`.
- Why: right after adding a vehicle, UI should already show the correct markup before any cart refresh.

4) Keep all payment/orchestration endpoints untouched
- Explicitly no edits to:
  - `mobile-create-order-from-cart`
  - `mobile-checkout`
  - provider selection/verification/payment callbacks
- Only cart/config response contract hardening.

Validation checklist after implementation
- Vehicle pending quote case:
  - Base `16480` must return `itemMarginUsd=1648`, `markupFeeUsd=1648`, `markupPercent=10`, `summary.effectiveMarkupPercent=10`.
- Vehicle quoted case:
  - Must return stored quote values unchanged with same alias fields.
- Regular item case:
  - Must still show general markup percent and existing totals.
- Contract compatibility:
  - `activeItems` and `items` both present and identical.
- Runtime check:
  - Review `mobile-get-cart` function logs to confirm output values match expected.
  - Confirm no payment-flow endpoints were modified.

Technical note
- This fix assumes the remaining discrepancy is caused by client fallback logic when expected fields are absent or ambiguous.
- By returning authoritative totals and broad aliases from the backend, we make the mobile app display correct markup before and after quote without requiring payment-flow changes.
