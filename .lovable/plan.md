
# Fix: Mobile "Add to Cart" Failure - Column Name Mismatch

## Problem Summary

The "Add to Cart" button fails on mobile with error "Failed to add item to cart". The edge function logs reveal:

```
ERROR: Could not find the 'captured_price_usd' column of 'order_items' in the schema cache
```

## Root Cause

The `mobile-add-cart-item` edge function is trying to insert columns that don't exist in the `order_items` table:

| Code Uses | Actual DB Column | Status |
|-----------|------------------|--------|
| `captured_price_usd` | `captured_price` | ❌ Wrong suffix |
| `proposed_price_usd` | (none) | ❌ Does not exist |

The insert fails immediately when attempting to use non-existent column names.

---

## Solution

Fix the column name mapping in `supabase/functions/mobile-add-cart-item/index.ts`:

### File: `supabase/functions/mobile-add-cart-item/index.ts`

**Lines 297-300 - Change from:**
```typescript
captured_price_usd: userEdited ? (body.capturedPrice ?? body.captured_price ?? null) : null,
proposed_price_usd: userEdited ? productPrice : null,
```

**To:**
```typescript
captured_price: userEdited ? (body.capturedPrice ?? body.captured_price ?? null) : null,
// Note: proposed_price_usd removed - column doesn't exist
// The admin_adjusted_price column will be used when admin reviews
```

---

## Technical Details

The fix involves:

1. **Rename `captured_price_usd`** → `captured_price` (line 299)
2. **Remove `proposed_price_usd`** - This column doesn't exist. The intended behavior (storing user's proposed price when they manually edit) can use `base_price_usd` which is already being set

---

## Complete Change (Lines 285-309)

```typescript
// Insert new item
const newItem = {
  order_id: draft.id,
  product_url: productUrl,
  title: productTitle,
  product_image_url: productImageUrl,
  store,
  quantity,
  base_price_usd: productPrice,
  shipping_item_type_id: finalShippingTypeId,
  est_weight_kg: estWeightKg,
  requires_manual_quote: requiresManualQuote,
  is_saved_for_later: false,
  price_source: userEdited ? "manual_user" : "auto",
  price_confirmation_status: userEdited ? "pending" : null,
  captured_price: userEdited ? (body.capturedPrice ?? body.captured_price ?? null) : null,
  // Note: proposed price is stored in base_price_usd above
};
```

---

## Expected Result

After this fix:
- Mobile app can successfully add items to cart
- Guest users get price calculations
- Authenticated users get items persisted to database
- No schema mismatch errors
- No regressions to web functionality (same endpoint used)

---

## Files to Modify

1. **`supabase/functions/mobile-add-cart-item/index.ts`** - Fix column names at lines 299-300
