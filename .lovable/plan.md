

## Fix: Mobile App Showing Wrong Markup for Vehicles

### Problem

A $16,480 vehicle shows a $3,296 markup fee in the mobile app. That's exactly 20% (the general markup), but admin has set the vehicle-specific markup to 10% (`category_markups.vehicles = 10`). The correct markup should be $1,648.

**Root cause**: The `mobile-get-cart` API correctly calculates `itemMarginUsd: 1648` per item, but does NOT include the markup percentages in its response. The mobile React Native app likely recalculates the markup locally using `markupPercent` (20%) from `mobile-public-config`, applying the general rate to vehicles instead of the vehicle-specific rate.

### Solution

Add markup percentage fields to the `mobile-get-cart` API response so the mobile app can correctly identify which markup applies:

1. **Per-item**: Add `effectiveMarkupPercent` to each formatted item (10 for vehicles, 20 for regular items)
2. **Summary level**: Add `markupPercent` and `vehicleMarkupPercent` to the cart summary so the mobile app has both rates available

This way, even if the mobile app recalculates locally, it will use the correct percentage. And the pre-calculated `itemMarginUsd` remains the authoritative value.

### File to Modify

**`supabase/functions/mobile-get-cart/index.ts`**

#### Change 1: Add `effectiveMarkupPercent` to vehicle pending-quote response (line ~209)
Add `effectiveMarkupPercent: vehicleMarkupPercent` to the return object for vehicles without quotes.

#### Change 2: Add `effectiveMarkupPercent` to vehicle with-quote response (line ~180)
Add `effectiveMarkupPercent: vehicleMarkupPercent` to the return object for vehicles with applied quotes.

#### Change 3: Add `effectiveMarkupPercent` to regular product response (line ~241)
Add `effectiveMarkupPercent: markupPercent` to the return object for regular products.

#### Change 4: Add markup rates to summary (line ~529)
Add `markupPercent` and `vehicleMarkupPercent` to the summary object so the mobile app has both rates:

```text
const summary = {
  // ... existing fields
  markupPercent,           // General markup (e.g., 20)
  vehicleMarkupPercent,    // Vehicle-specific markup (e.g., 10)
};
```

### Impact

- No changes to calculation logic -- only adds informational fields
- Mobile app can use `item.effectiveMarkupPercent` for local display or `item.itemMarginUsd` directly (recommended)
- Summary-level rates let the mobile app know both percentages without a separate `public-config` call
- No payment flow changes
