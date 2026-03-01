
# Fix Paste Link Breakdown Card

## Changes needed in `src/components/shop/PasteBreakdownCard.tsx`

### 1. Hide markup percentage — show only "Service Fee" / "Frais de service"
Line 89 currently shows `({markupPercent}%)` next to the service fee label. Remove the percentage display so it just says "Service Fee" or "Frais de service" without revealing the exact markup rate.

### 2. Confirm fees are dynamic (not hardcoded)
The markup and shipping are already pulled from `feeSettings` (from `useShopCart` context, sourced from `mobile-public-config`). No hardcoded values exist -- this is already correct. No changes needed here.

### 3. Vehicle detection for pasted links
Vehicle detection is already working via `detectVehicle()` in `PasteLink.tsx` (line 80). The breakdown card already shows "Quote Required" for shipping and hides the total for vehicles. The `addItem` call already passes `isVehicle: true` and `requiresManualQuote: true` (lines 51-52). This is already correct.

## Summary
Only one small change: remove `({markupPercent}%)` from line 89 of `PasteBreakdownCard.tsx`. Everything else (dynamic fees, vehicle quote requirement) is already properly implemented.
