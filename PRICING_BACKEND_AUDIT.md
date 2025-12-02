# Pricing Backend Audit - AfriShop

## Consolidated Pricing Configuration

All pricing is controlled via the `settings` table with these active fields:

| Field | Description | Example |
|-------|-------------|---------|
| `markup_percent` | Profit margin on items | 15 (= 15%) |
| `shipping_base_fee_usd` | Flat shipping fee | $20.00 |
| `shipping_percent` | % of order value added to shipping | 0.10 (= 10%) |
| `exchange_rate_usd_to_cdf` | USD to CDF conversion | 2800 |

**Removed/Unused Fields:**
- `service_fee_percent` - redundant (use markup_percent)
- `min_service_fee_usd` - no longer applied
- `global_markup_percent` - use markup_percent instead

---

## Pricing Formulas

### Per Item:
```
itemSubtotal = basePrice × quantity
itemMargin = itemSubtotal × (markup_percent / 100)
itemTotal = itemSubtotal + itemMargin
```

### For Cart/Order:
```
itemsTotal = Σ itemSubtotal
marginTotal = Σ itemMargin
itemsWithMarkup = Σ itemTotal
shippingFee = shipping_base_fee + (itemsTotal × shipping_percent)
grandTotal = itemsWithMarkup + shippingFee
grandTotalCdf = grandTotal × exchange_rate
```

---

## Test Cases

### Example: $799 item × 3, markup=15%, shipping=$20+10%

| Step | Calculation | Result |
|------|-------------|--------|
| Items Subtotal | $799 × 3 | **$2,397.00** |
| Margin (15%) | $2,397 × 0.15 | **$359.55** |
| Items with Markup | $2,397 + $359.55 | **$2,756.55** |
| Shipping Fee | $20 + ($2,397 × 0.10) | **$259.70** |
| Grand Total USD | $2,756.55 + $259.70 | **$3,016.25** |
| Grand Total CDF | $3,016.25 × 2800 | **8,445,500 FC** |

### Simple Test: $100 × 2 items

| Step | Calculation | Result |
|------|-------------|--------|
| Items Subtotal | $100 × 2 | **$200.00** |
| Margin (15%) | $200 × 0.15 | **$30.00** |
| Items with Markup | $200 + $30 | **$230.00** |
| Shipping Fee | $20 + ($200 × 0.10) | **$40.00** |
| Grand Total USD | $230 + $40 | **$270.00** |

---

## Database Fields

### order_items table (per item):
| Field | Description |
|-------|-------------|
| `base_price_usd` | Per-unit base price |
| `quantity` | Number of items |
| `subtotal_usd` | base_price × quantity |
| `markup_fee_usd` | subtotal × markup% |
| `total_price_usd` | subtotal + markup |
| `total_price_cdf` | total_price × exchange_rate |
| `shipping_fee_usd` | Always 0 (shipping at order level) |

### orders table (totals):
| Field | Description |
|-------|-------------|
| `item_total_usd` | Sum of all item subtotals |
| `service_fee_usd` | Sum of all item margins |
| `shipping_fee_usd` | base + (item_total × shipping%) |
| `total_usd` | item_total + service_fee + shipping |
| `total_cdf` | total_usd × exchange_rate |
| `exchange_rate_used` | Rate at time of calculation |

---

## Edge Functions

All cart functions use the same canonical logic:

1. **mobile-add-cart-item** - Adds/merges items, updates order totals
2. **mobile-update-cart-item** - Updates quantity, recalculates totals
3. **mobile-delete-cart-item** - Removes item, recalculates totals
4. **mobile-get-cart** - Returns items + summary from persisted totals
5. **mobile-create-order-from-cart** - Converts DRAFT to PENDING_PAYMENT
6. **admin-get-carts** - Returns carts with correct totals for admin view

---

## API Response Format

### GET /mobile-get-cart
```json
{
  "items": [
    {
      "id": "uuid",
      "store": "CARVANA",
      "basePriceUsd": 799.00,
      "quantity": 3,
      "subtotalUsd": 2397.00,
      "markupFeeUsd": 359.55,
      "totalPriceUsd": 2756.55,
      "totalPriceCdf": 7718340
    }
  ],
  "summary": {
    "itemCount": 3,
    "totalItemsUsd": 2397.00,
    "totalMarginUsd": 359.55,
    "itemsSubtotalUsd": 2756.55,
    "shippingFeeUsd": 259.70,
    "grandTotalUsd": 3016.25,
    "grandTotalCdf": 8445500,
    "exchangeRate": 2800
  }
}
```

---

## Admin Settings UI

The settings page (`/admin/settings`) is organized into:

1. **Language Preferences** - Portal language selection
2. **Currency Settings** - Exchange rate only
3. **Profit Margin** - Markup percentage
4. **Shipping Settings** - Base fee + percentage
5. **Example Calculation** - Live preview of pricing
6. **Advanced** (collapsible) - Category markups, extra fees, discount codes
