

# Fix: Slow Order Deletion + Cars Section BMW Bias

## Issue 1: Bulk Order Deletion Is Too Slow

### Root Cause
The admin bulk delete (visible in the screenshot deleting 31 orders) calls the `admin-delete-order` edge function **one at a time in a sequential for-loop**. Each call performs **11+ sequential database operations** (deleting from order_actions, order_items, payments, maisha_payments, checkout_sessions, payment_attempts, manual_transfer_sessions, manual_transfer_proofs, bank_transfer_view_tokens, payment_links, cart_recovery tables, quote_requests, then the order itself, then an audit log insert).

For 31 orders: ~31 calls x 11 DB operations x ~50ms each = **~17 seconds minimum**.

### Fix

**A. Create a new `admin-bulk-delete-orders` edge function** that accepts an array of order IDs and deletes them all in bulk SQL operations instead of one-at-a-time:

- Delete from all child tables using `WHERE order_id = ANY($1)` (single query per table instead of 31)
- Batch the audit log inserts into one multi-row INSERT
- This reduces 341 DB calls down to ~13 total (one per table + audit)

**B. Update `src/pages/admin/Orders.tsx`** to call the new bulk endpoint instead of looping over the single-delete function.

### Files

| File | Change |
|------|--------|
| `supabase/functions/admin-bulk-delete-orders/index.ts` | New edge function accepting `{ orderIds: string[] }`, performing bulk deletes |
| `src/pages/admin/Orders.tsx` | Replace sequential for-loop with single call to `admin-bulk-delete-orders` |

---

## Issue 2: Cars/Vehicles Section Shows Mostly BMW

### Root Cause

The `home_recipe_seeds` table for the `vehicles` recipe has **duplicate entries**: "BMW X5" appears 3 times and "BMW X5 SUV" once, giving BMW disproportionate weight. The current cache data confirms this: **62 BMW items vs 20 Toyota and 1 Other** -- no Honda, Ford, Mercedes, Tesla, Chevrolet, Jeep, or other brands appear at all.

Additionally, many of the BMW results are **accessories/parts** (door handles, emblems, control arms, grilles) rather than actual vehicles, because the eBay search for "BMW X5" returns parts alongside listings.

### Fix

**A. Clean up duplicate seeds** in the `home_recipe_seeds` database table:
- Remove duplicate "BMW X5" entries (keep just 1)
- Remove duplicate entries for other makes that also appear multiple times (Toyota RAV4 x2, Honda CR-V x2, Ford Explorer x2, etc.)

**B. Force a recipe cache rebuild** after cleaning seeds so the new, balanced seed list takes effect.

**C. Verify the `motorsFilter.ts` accessory filtering** is being applied during recipe building to strip out parts/accessories from vehicle results.

### Data Changes

| Table | Change |
|-------|--------|
| `home_recipe_seeds` | Remove duplicate BMW X5 and other duplicate vehicle seed entries |

No code file changes needed for this issue -- it is a data problem in the seeds table.

---

## Technical Details

### Bulk Delete Function Structure

```typescript
// admin-bulk-delete-orders/index.ts
// 1. Auth check (same as existing)
// 2. Accept { orderIds: string[] } (max 100)
// 3. Fetch order details for audit log
// 4. Bulk delete from child tables:
//    - order_actions WHERE order_id IN (...)
//    - order_items WHERE order_id IN (...)
//    - payments WHERE order_id IN (...)
//    - maisha_payments WHERE order_id IN (...)
//    - checkout_sessions WHERE order_id IN (...)
//    - payment_attempts WHERE order_id IN (...)
//    - manual_transfer_proofs via session IDs
//    - manual_transfer_sessions WHERE order_id IN (...)
//    - bank_transfer_view_tokens WHERE order_id IN (...)
//    - payment_links WHERE order_id IN (...)
//    - cart_recovery_ab_tests WHERE order_id IN (...)
//    - cart_recovery_predictions WHERE order_id IN (...)
//    - quote_requests via item IDs
//    - orders WHERE id IN (...)
// 5. Batch insert audit logs
```

### Frontend Bulk Delete Change

```typescript
// Before: sequential loop (slow)
for (const orderId of orderIds) {
  await supabase.functions.invoke('admin-delete-order', { body: { orderId } });
}

// After: single call (fast)
const { data, error } = await supabase.functions.invoke('admin-bulk-delete-orders', {
  body: { orderIds }
});
```

### Seed Cleanup (duplicates to remove)

```text
Duplicates found in home_recipe_seeds for vehicles:
- "BMW X5" appears 3x (keep 1)
- "Toyota RAV4" appears 2x (keep 1, remove "Toyota RAV4 SUV" variant)
- "Honda CR-V" appears 2x (keep 1, remove "Honda CR-V SUV" variant)
- "Ford Explorer" appears 2x (keep 1, remove "Ford Explorer SUV" variant)
- "Toyota Camry" appears 2x (keep 1)
- "Honda Civic" appears 2x (keep 1)
```

After cleanup and cache rebuild, the vehicles section should show a balanced mix of all makes.
