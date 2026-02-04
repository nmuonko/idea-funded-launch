
# Fix Checkout Payment Failure - Database Constraints and Cart Sync

## Problem Summary

There are two issues preventing checkout from completing:

1. **Database constraint violation** - The `mobile-checkout` function tries to insert `pay_method: 'CHOICE_REQUIRED'` and `status: 'choice_required'` but these values are not allowed by the `checkout_sessions` table constraints
2. **Cart items not syncing** - When `productUrl` is missing, the fallback generates `https://afrishop.com/...` which is rejected by the edge function's allowed domains validation

---

## Issue 1: Database Constraint Fix

### Current Constraints

```sql
-- pay_method only allows CARD or MOBILE_MONEY
CHECK ((pay_method = ANY (ARRAY['CARD', 'MOBILE_MONEY'])))

-- status does not include choice_required  
CHECK ((status = ANY (ARRAY['awaiting_provider_selection', ...])))
```

### Fix Required

Add a database migration to update the CHECK constraints:

```sql
-- Drop and recreate pay_method constraint to include BANK_TRANSFER and CHOICE_REQUIRED
ALTER TABLE checkout_sessions DROP CONSTRAINT checkout_sessions_pay_method_check;
ALTER TABLE checkout_sessions ADD CONSTRAINT checkout_sessions_pay_method_check 
  CHECK (pay_method = ANY (ARRAY['CARD', 'MOBILE_MONEY', 'BANK_TRANSFER', 'CHOICE_REQUIRED']));

-- Drop and recreate status constraint to include choice_required
ALTER TABLE checkout_sessions DROP CONSTRAINT checkout_sessions_status_check;
ALTER TABLE checkout_sessions ADD CONSTRAINT checkout_sessions_status_check 
  CHECK (status = ANY (ARRAY[
    'awaiting_provider_selection', 'provider_selected', 'initiated', 
    'pending', 'processing', 'paid', 'failed', 'cancelled', 'expired', 
    'choice_required'
  ]));
```

---

## Issue 2: Cart Item productUrl Fix

### Problem

When `productUrl` is missing from a cart item, the current fallback generates:
```
https://afrishop.com/product/rainforest/amazon_B0BP7JJWHC
```

But the edge function's `ALLOWED_DOMAINS` list only includes:
- amazon.com, ebay.com, walmart.com, bestbuy.com, etc.

It does NOT include `afrishop.com`, so the fallback URL is rejected.

### Fix Required

Update `ShopCartContext.tsx` to generate proper Amazon/eBay URLs using the `productId`:

```typescript
// Current fallback (WRONG - domain not allowed)
productUrl = `https://afrishop.com/product/${item.provider}/${item.productId}`;

// Fixed fallback (CORRECT - uses allowed domains)
if (item.provider === 'ebay') {
  productUrl = `https://www.ebay.com/itm/${item.productId}`;
} else if (item.provider === 'amazon' || item.provider === 'rainforest') {
  // Extract ASIN from productId (may have prefix like "amazon_B0XYZ123")
  let asin = item.productId;
  if (asin.toLowerCase().startsWith('amazon_')) {
    asin = asin.slice(7);
  } else if (asin.toLowerCase().startsWith('rainforest_')) {
    asin = asin.slice(11);
  }
  productUrl = `https://www.amazon.com/dp/${asin}`;
} else {
  // For other providers, still try amazon.com as default
  productUrl = `https://www.amazon.com/dp/${item.productId}`;
}
```

---

## Files to Modify

| File | Change |
|------|--------|
| Database migration | Add `CHOICE_REQUIRED` and `BANK_TRANSFER` to pay_method constraint; add `choice_required` to status constraint |
| `src/contexts/ShopCartContext.tsx` | Fix productUrl fallback to use allowed domains (amazon.com, ebay.com) |

---

## Technical Details

### Migration SQL

```sql
-- Fix checkout_sessions constraints for CHOICE_REQUIRED payment flow

-- 1. Update pay_method constraint
ALTER TABLE checkout_sessions DROP CONSTRAINT IF EXISTS checkout_sessions_pay_method_check;
ALTER TABLE checkout_sessions ADD CONSTRAINT checkout_sessions_pay_method_check 
  CHECK (pay_method = ANY (ARRAY['CARD'::text, 'MOBILE_MONEY'::text, 'BANK_TRANSFER'::text, 'CHOICE_REQUIRED'::text]));

-- 2. Update status constraint  
ALTER TABLE checkout_sessions DROP CONSTRAINT IF EXISTS checkout_sessions_status_check;
ALTER TABLE checkout_sessions ADD CONSTRAINT checkout_sessions_status_check 
  CHECK (status = ANY (ARRAY[
    'awaiting_provider_selection'::text, 
    'provider_selected'::text, 
    'initiated'::text, 
    'pending'::text, 
    'processing'::text, 
    'paid'::text, 
    'failed'::text, 
    'cancelled'::text, 
    'expired'::text, 
    'choice_required'::text
  ]));
```

### ShopCartContext.tsx Update

```typescript
// In addItem function, replace the fallback URL logic:

let productUrl = item.productUrl;
if (!productUrl && item.productId) {
  // Extract clean product ID (remove provider prefix if present)
  let cleanId = item.productId;
  const lowerCleanId = cleanId.toLowerCase();
  
  if (lowerCleanId.startsWith('amazon_')) {
    cleanId = cleanId.slice(7);
  } else if (lowerCleanId.startsWith('rainforest_')) {
    cleanId = cleanId.slice(11);
  } else if (lowerCleanId.startsWith('ebay_')) {
    cleanId = cleanId.slice(5);
  }
  
  // Build URL using allowed domain based on provider
  if (item.provider === 'ebay') {
    productUrl = `https://www.ebay.com/itm/${cleanId}`;
  } else {
    // Default to Amazon for rainforest/amazon providers
    productUrl = `https://www.amazon.com/dp/${cleanId}`;
  }
}
```

---

## Expected Result After Fix

1. **Database constraint updated** - `CHOICE_REQUIRED` payment flow will work
2. **Cart items sync properly** - Fallback URLs use allowed domains
3. **Checkout completes** - Both mobile money (Pawapay) and card (Stripe) payments will work

---

## Testing Steps

1. Clear browser cart/localStorage
2. Add a product to cart from the shop
3. Proceed to checkout
4. Select payment method (mobile money or card)
5. Payment should process successfully
