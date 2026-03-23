

## Root Cause

The `mobile-checkout` function creates the checkout order with `status: 'PENDING_PAYMENT'` (line 2039), then immediately tries to insert `order_items` into it. But the RLS policy on `order_items` only allows INSERT when the parent order has `status = 'DRAFT'`:

```sql
-- Current policy: "Users can insert items to their draft orders"
EXISTS (SELECT 1 FROM orders WHERE orders.id = order_items.order_id 
  AND orders.user_id = auth.uid() AND orders.status = 'DRAFT')
```

This means **every non-admin user** fails at checkout. `kadimisha@gmail.com` only works because they have the `admin` role, which uses the permissive "Admins can manage all order items" (ALL) policy.

This is the exact error in the logs:
```
new row violates row-level security policy for [order_items]
```

## Fix

**Database migration**: Add a new RLS policy on `order_items` that allows users to insert items into their own `PENDING_PAYMENT` orders (in addition to DRAFT orders). This is the correct semantic — checkout creates a PENDING_PAYMENT order and needs to populate it with items.

```sql
CREATE POLICY "Users can insert items to their pending payment orders"
ON public.order_items
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM orders
    WHERE orders.id = order_items.order_id
      AND orders.user_id = auth.uid()
      AND orders.status = 'PENDING_PAYMENT'
  )
);
```

This is a single SQL migration. No code changes needed. The existing normalization logic and checkout flow are correct — only the RLS policy was blocking the insert.

### Why this is safe
- The policy is scoped to `authenticated` users only
- It checks `orders.user_id = auth.uid()` — users can only add items to their own orders
- It only applies to `PENDING_PAYMENT` status — not completed or cancelled orders
- It complements the existing DRAFT insert policy

### Expected result
- `ngoyprecious@gmail.com` and `kabuyachadrack94@gmail.com` will be able to check out immediately
- All future non-admin users will be able to check out
- No frontend/OTA changes needed

