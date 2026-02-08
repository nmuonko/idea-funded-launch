
# Fix: Vehicle Detection and Checkout Blocking for Web App

## Root Cause Analysis

There are **two bugs** preventing the vehicle checkout blocking from working:

### Bug 1: `is_vehicle` column never written to database
In the `mobile-add-cart-item` edge function, when a new cart item is inserted (lines 286-301), the `is_vehicle` field is **not included** in the insert object. Even though the detection correctly identifies "2011 Ford Fusion HYBRID..." as a vehicle (`isVehicle = true`), this value is never saved to the database. The `is_vehicle` column defaults to `false`.

### Bug 2: `mobile-get-cart` ignores `requires_manual_quote` for non-vehicle items
In `mobile-get-cart` (line 232), when an item has `is_vehicle = false`, the code hardcodes `requiresManualQuote = false` regardless of what the database says. This means even though `requires_manual_quote = true` is stored in the DB, it's overridden and the checkout proceeds.

### Result
- `is_vehicle` is `false` in DB (Bug 1)
- `mobile-get-cart` reports `hasVehicleItems: false` and `canProceedToPayment: true` (Bug 2)
- Checkout page skips the blocking guard entirely
- User can proceed to payment for a $6,996 vehicle with no shipping quote

## Fix Plan

### Fix 1: `supabase/functions/mobile-add-cart-item/index.ts`
Add `is_vehicle: isVehicle` to the new item insert object (around line 297).

```
is_vehicle: isVehicle,
requires_manual_quote: requiresManualQuote,
```

### Fix 2: `supabase/functions/mobile-get-cart/index.ts`
Change line 232 to respect the database `requires_manual_quote` column instead of hardcoding `false`:

```
const itemRequiresQuote = item.requires_manual_quote === true;
```

### Fix 3: Fix the existing Ford Fusion record
Run a SQL update to correct the existing cart item so the user can see the blocking immediately:

```sql
UPDATE order_items 
SET is_vehicle = true 
WHERE id = '779f6dfb-871a-4972-9954-40a54ed5fb9a';
```

## Summary of Changes

| File | Change |
|------|--------|
| `supabase/functions/mobile-add-cart-item/index.ts` | Add `is_vehicle` to the insert object |
| `supabase/functions/mobile-get-cart/index.ts` | Respect `requires_manual_quote` from DB instead of hardcoding `false` |
| Database migration | Fix existing Ford Fusion record |

After these fixes:
- New vehicle items will have `is_vehicle = true` saved correctly
- The cart API will report `hasVehicleItems = true` and `canProceedToPayment = false`
- The checkout page will show the "Shipping Quote Required" blocking screen
- The cart page will show the "Request Shipping Quote" button
