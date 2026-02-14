

# Fix: PriceBreakdown Uses Wrong Vehicle Flag for Selected Items

## Problem

When the vehicle (Toyota RAV4) is deselected in the cart, the Order Summary for the two remaining phones still shows:
- Markup Fee: "Included in quote"
- Shipping Fee: "Awaiting quote"

This happens because `PriceBreakdown` reads `hasVehicleItems` from the global cart context, which checks ALL cart items (including unselected ones). The cart page passes `isVehicle={selectedHasVehicleItems}` as a prop, but PriceBreakdown ignores it for the `showPendingQuote` decision.

## Fix

**File: `src/components/shop/PriceBreakdown.tsx`** (line 37)

Change `showPendingQuote` to use the `isVehicle` prop (which reflects selected state in the cart) instead of `hasVehicleItems` from context:

```typescript
// Before (broken):
const showPendingQuote = !isDetailVehicle && hasVehicleItems && vehicleQuoteStatus !== 'quoted';

// After (fixed):
const showPendingQuote = !isDetailVehicle && isVehicle && vehicleQuoteStatus !== 'quoted';
```

This means:
- Cart with vehicle **selected**: `isVehicle=true` (passed as `selectedHasVehicleItems`) -> shows quote pending UI
- Cart with vehicle **deselected**: `isVehicle=false` -> shows normal markup + shipping fees
- Product detail page for vehicle: handled separately by `isDetailVehicle` (unchanged)

No other files need changes. The `ShopCart.tsx` already passes the correct `selectedHasVehicleItems` value.

## Files Modified
- `src/components/shop/PriceBreakdown.tsx` -- one-line fix on line 37
