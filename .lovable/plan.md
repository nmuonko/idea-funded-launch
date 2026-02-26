

## Fix: Vehicle Pricing Pipeline -- Markup and Quote Totals Not Respected

### Problem

When an admin applies a vehicle quote (e.g., base $6,480 + 10% markup $648 + shipping $1,000 = $8,128), the prices shown to users are wrong because:

1. **Web cart displays base price, not quoted total**: `priceUsd` in the cart is set to `basePriceUsd` (the raw vehicle price). The cart summary passes this base price to `PriceBreakdown`, which then recalculates markup and shipping locally using general formulas -- completely ignoring the admin-applied quote values stored in the backend.

2. **PriceBreakdown ignores server-stored quote data**: For quoted vehicles, the component recalculates `serviceFee = subtotal * markupRate` and `shippingFee = base + subtotal * percent` using the generic shipping formula. But the admin already set exact values ($648 markup, $1,000 shipping) -- those are never passed to or used by this component.

3. **Order creation ignores stored item totals**: `mobile-create-order-from-cart` reads `subtotal_usd`, `markup_fee_usd`, `total_price_usd` from the DB but these can be null for regular items (never populated at add-time). The `calculateCartSummary` function sums these potentially-null values, producing incorrect order totals.

### Solution

#### Change 1: Cart items carry server-calculated totals (ShopCartContext.tsx)

When mapping backend cart items to frontend `CartItem`, add fields for the server-provided breakdown:

- `itemMarginUsd` -- from backend's `itemMarginUsd`
- `itemShippingUsd` -- from backend's `itemShippingUsd` or `shippingCost`
- `itemTotalUsd` -- from backend's `itemTotalUsd` or `price` (the line total including markup + shipping)

Update `priceUsd` for quoted vehicles to use `itemTotalUsd` (the full price) instead of `basePriceUsd`. This ensures `selectedTotalUsd` (which sums `priceUsd * quantity`) reflects the real total.

For non-vehicle items, `priceUsd` continues to be `basePriceUsd` since `PriceBreakdown` handles markup/shipping calculation for those.

#### Change 2: PriceBreakdown uses server values for quoted vehicles (PriceBreakdown.tsx)

Add optional props: `serverMarginUsd`, `serverShippingUsd`, `serverTotalUsd` (item-level, not cart-level).

When a vehicle has a quote applied (`isVehicle && vehicleQuoteStatus === 'quoted'`):
- Display the server-provided margin instead of recalculating
- Display the server-provided shipping instead of using the generic formula
- Display the server-provided total instead of summing locally

This ensures the exact values the admin set are shown to the user.

#### Change 3: ShopCart.tsx passes server data to PriceBreakdown

When rendering the Order Summary for selected items:
- Sum `itemMarginUsd` and `itemShippingUsd` from selected items
- Pass these as `serverMarginUsd` and `serverShippingUsd` to `PriceBreakdown`
- For quoted vehicles, pass the item's base price (not total) as `itemPriceUsd` so the breakdown shows: Base + Margin + Shipping = Total correctly

#### Change 4: Fix order creation to use correct totals (mobile-create-order-from-cart)

Update `calculateCartSummary` to handle two cases:
- **Quoted vehicles**: Use `total_price_usd`, `markup_fee_usd`, `shipping_fee_usd` directly from DB (already stored by `admin-apply-vehicle-quote`)
- **Regular items**: Recalculate from `base_price_usd` using settings (markup percent, shipping formula) since these fields may be null

This ensures the PENDING_PAYMENT order has correct totals matching what the user sees.

### Files to Modify

| File | Change |
|------|--------|
| `src/contexts/ShopCartContext.tsx` | Add `itemMarginUsd`, `itemShippingUsd`, `itemTotalUsd` to CartItem interface. Map from backend response. Set `priceUsd` to `itemTotalUsd` for quoted vehicles. |
| `src/components/shop/PriceBreakdown.tsx` | Accept and display server-provided margin/shipping/total for quoted vehicles instead of recalculating. |
| `src/pages/shop/ShopCart.tsx` | Aggregate and pass server breakdown values to PriceBreakdown for quoted vehicles. |
| `supabase/functions/mobile-create-order-from-cart/index.ts` | Rewrite `calculateCartSummary` to recalculate regular items from base price + settings, and use stored values for quoted vehicles. |

### Technical Details

**CartItem interface additions:**
```text
interface CartItem {
  // ... existing fields
  itemMarginUsd?: number;
  itemShippingUsd?: number;
  itemTotalUsd?: number;
}
```

**Mapping in syncCart (ShopCartContext.tsx line ~375):**
```text
priceUsd: (item.vehicleQuoteApplied && item.itemTotalUsd)
  ? item.itemTotalUsd
  : (item.basePriceUsd || 0),
itemMarginUsd: item.itemMarginUsd || 0,
itemShippingUsd: item.itemShippingUsd || item.shippingCost || 0,
itemTotalUsd: item.itemTotalUsd || item.price || 0,
```

**PriceBreakdown for quoted vehicles:**
```text
// When serverMarginUsd and serverShippingUsd are provided, use them directly
const displayMargin = serverMarginUsd ?? serviceFee;
const displayShipping = serverShippingUsd ?? shippingFee;
const displayTotal = serverTotalUsd ?? total;
```

**mobile-create-order-from-cart calculateCartSummary fix:**
```text
// For each item:
if (item.is_vehicle && item.vehicle_quote_applied && item.total_price_usd > 0) {
  // Use stored values from admin quote
  totalItemsUsd += Number(item.base_price_usd || 0);
  totalMarginUsd += Number(item.markup_fee_usd || 0);
  totalShippingUsd += Number(item.shipping_fee_usd || 0);
  grandTotal += Number(item.total_price_usd || 0);
} else {
  // Recalculate from base price + settings
  const base = Number(item.base_price_usd || 0) * (item.quantity || 1);
  const margin = round2(base * (markupPercent / 100));
  totalItemsUsd += base;
  totalMarginUsd += margin;
  grandTotal += base + margin;
}
```
