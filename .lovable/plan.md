
You’re right to focus on the Replit mobile code now. The backend here is already returning the correct vehicle margin, so the remaining mismatch is almost certainly in how the React Native app reads or recalculates cart totals.

Issue restated clearly:
- Vehicle base price: 16,480
- App shows markup: 3,296 (20%)
- Admin vehicle markup is 10% (should be 1,648)
- Backend logs already show 1,648, so the app is likely recalculating with general markup or showing fallback/stale values when cart fetch errors happen.

Do I know what the issue is?
- Yes: backend response is correct; mobile app integration is likely using the wrong source of truth (local formula/global markup) instead of per-item/server-calculated cart values, especially around error fallback.

What file in Replit to open first (priority order):
1) API client / backend gateway (how requests are made)
- Likely names:
  - `src/services/api.ts`
  - `src/lib/apiClient.ts`
  - `src/lib/supabase.ts`
  - `src/config/env.ts`
- Why: confirms base URL/project, auth token headers, and which endpoint is actually being called.

2) Cart service (maps `/mobile-get-cart` response)
- Likely names:
  - `src/services/cartService.ts`
  - `src/features/cart/cartApi.ts`
  - `src/api/cart.ts`
- Why: this is where `summary.markupFeeUsd`, `item.markupFeeUsd`, `item.itemMarginUsd`, `item.effectiveMarkupPercent` should be read.

3) Cart state store/context (where totals get recalculated)
- Likely names:
  - `src/store/cartSlice.ts`
  - `src/context/CartContext.tsx`
  - `src/hooks/useCart.ts`
- Why: most likely location of buggy formula like `basePrice * (config.markup.value / 100)`.

4) Cart screen UI component (where wrong amount appears)
- Likely names:
  - `src/screens/CartScreen.tsx`
  - `src/features/cart/CartSummary.tsx`
  - `src/components/cart/PriceSummary.tsx`
- Why: often re-derives totals for display and can ignore server fields.

5) Pricing utility + public config usage
- Likely names:
  - `src/utils/pricing.ts`
  - `src/utils/cartCalculations.ts`
  - `src/services/publicConfigService.ts`
- Why: if cart uses `mobile-public-config.markup.value` globally, vehicle items become 20% instead of 10%.

Exact search terms to run in Replit (fastest way to locate code):
```text
mobile-get-cart
mobile-public-config
markupFeeUsd
itemMarginUsd
effectiveMarkupPercent
vehicleMarkupPercent
markup.value
vehicleValue
An unexpected error occurred
Demander un devis
Montant à payer
```

What the Replit code should do (target behavior):
- Cart display should use backend-calculated values directly:
  - Item margin: `item.markupFeeUsd || item.itemMarginUsd`
  - Cart margin: `summary.markupFeeUsd`
  - Cart total: `summary.totalUsd`
- Do not recompute cart margin from `config.markup.value`.
- If a fallback formula is unavoidable:
  - use `item.effectiveMarkupPercent`
  - or if missing: `item.isVehicle ? config.markup.vehicleValue : config.markup.value`
- In cart fetch error state (“An unexpected error occurred”), do not keep stale totals on screen.

Why this is important with your already-submitted AAB:
- Backend-only fixes help only if app consumes backend fields.
- If app recalculates locally, you need a mobile app patch release (new build) to fully fix user-visible markup.
- A quick hotfix release can be limited to cart parsing/calculation files above; payment flow stays untouched.

Backend contract reference (for the mobile dev to align with):
- `supabase/functions/mobile-get-cart/index.ts`
  - Per-item fields include `markupFeeUsd`, `itemMarginUsd`, `effectiveMarkupPercent`, `markupPercent`
  - Summary includes `markupFeeUsd`, `generalMarkupPercent`, `vehicleMarkupPercent`, `effectiveMarkupPercent`
- `MOBILE_APP_INTEGRATION.md`
  - states cart should display pre-calculated summary/item values directly.

Execution plan from here:
1) You open the 5 file groups above in Replit and locate where cart totals are calculated.
2) Replace local margin calculations with server values in cart flow only.
3) Keep product-list estimate logic separate (it can still use public config).
4) Test one vehicle at 16,480:
   - Expected cart margin = 1,648
   - Expected shown percent = 10%
   - Before quote and after quote both consistent.
5) Ship a small mobile hotfix release without touching payment flow.

If you paste your Replit `cartService + CartScreen + pricing util` files next, I can give you exact line-level edits for that codebase.
