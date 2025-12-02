# Pricing Backend Audit - AfriShop

## Correct Pricing Formula

All cart-related edge functions now use this formula:

```
baseTotal = basePrice × quantity
margin = baseTotal × (markupPercent / 100)
itemSubtotal = baseTotal + margin
```

**Shipping is applied at order level, NOT per-item.**

## Test Cases

| Base Price | Qty | Markup % | Base Total | Margin | Item Subtotal |
|------------|-----|----------|------------|--------|---------------|
| $10.00     | 1   | 15%      | $10.00     | $1.50  | **$11.50**    |
| $26.99     | 1   | 15%      | $26.99     | $4.05  | **$31.04**    |
| $10.00     | 2   | 15%      | $20.00     | $3.00  | **$23.00**    |

## Updated Edge Functions

1. **mobile-add-cart-item** - Uses `calculateItemPricing()` helper
2. **mobile-update-cart-item** - Recalculates on quantity change
3. **mobile-get-cart** - Uses `calculateCartSummary()` helper
4. **mobile-delete-cart-item** - Uses `calculateCartSummary()` helper
5. **mobile-create-order-from-cart** - Uses `calculateCartSummary()` helper

## Database Fields (per order_item)

- `base_price_usd` - Per-unit base price
- `quantity` - Number of items
- `subtotal_usd` - base_price × quantity (itemBaseTotalUsd)
- `markup_fee_usd` - subtotal × markup% (itemMarginUsd)
- `total_price_usd` - subtotal + markup (itemSubtotalUsd)
- `total_price_cdf` - total_price_usd × exchange_rate
- `shipping_fee_usd` - 0 (shipping at order level)

## Cart Summary Response

```json
{
  "itemCount": 2,
  "totalItemsUsd": 36.99,      // Sum of subtotal_usd
  "totalMarginUsd": 5.55,      // Sum of markup_fee_usd
  "itemsSubtotalUsd": 42.54,   // Sum of total_price_usd
  "shippingFeeUsd": 10.00,     // From settings.shipping_base_fee_usd
  "grandTotalUsd": 52.54,      // itemsSubtotalUsd + shippingFeeUsd
  "grandTotalCdf": 147112,     // grandTotalUsd × exchangeRate
  "exchangeRate": 2800
}
```

## Key Changes Made

1. **Removed min_service_fee_usd** from markup calculation
2. **Shipping applied at order level only**, not per-item
3. **Single helper functions** in each edge function for consistency
4. **All values rounded to 2 decimals** at end of calculation
