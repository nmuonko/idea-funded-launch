

# Payment Flow Diagnosis and Fix Plan

## Problem Summary

All recent orders are stuck in DRAFT status. Zero `payment_attempts` records exist in the database ever. Checkout sessions reach `awaiting_provider_selection` but never progress to actual payment initiation.

## Root Cause Analysis

After thorough investigation of the database, edge functions, and frontend code, here are the identified issues:

### Issue 1: Order Status Conflict Between Steps

The web checkout has a 3-step flow:
1. **Step 1** (`mobile-orders` action=create): Finds DRAFT order, updates it to `PENDING_PAYMENT`, returns `order_id` + `order_item_ids`
2. **Step 2** (`mobile-orders` action=checkout → proxies to `mobile-checkout`): Looks for order in DRAFT or PENDING_PAYMENT status — this works
3. **Step 3** (`payments-provider` action=select → forwards to `select-payment-provider`): Creates `payment_attempt` and calls Stripe/PawaPay API

**The flow from Step 2 to Step 3 appears functional in code.** The `payments-provider` function IS deployed (confirmed via direct test — returns 401 without auth as expected).

### Issue 2: `payments-provider` Double Body Consumption

In `payments-provider/index.ts`, the `requireAuth()` function creates a Supabase client and calls `auth.getUser()` using the user's token (line 40). Then in the main handler (line 109), it does `clonedReq.json()` — but this is a clone from line 106, not the original `req`. 

However, the critical bug is in `forwardToFunction` (line 78): when `overrideBody` is NOT undefined (it's passed for `select` action), the function correctly sends the override body. BUT — the original `req` is passed along, and its body was consumed by `requireAuth`. The `forwardToFunction` only uses headers from `req`, not its body when `overrideBody` is provided, so this should be fine.

### Issue 3: Missing `payment_method` Field in Insert

Looking at `select-payment-provider/index.ts` line 297-311, the `payment_attempts` insert does NOT include `payment_method` — but the table has a non-nullable `payment_method` column with default `'MOBILE_MONEY'`. This means inserts for Stripe (card) would use the wrong default but would still succeed.

### Issue 4 (Most Likely Root Cause): `user_id` in `payment_attempts` Insert

The `payment_attempts` table has `user_id` as NOT NULL (line from schema). The insert in `select-payment-provider` includes `user_id: user.id` (line 302). The RLS policy `Users can create payment attempts` requires `auth.uid() = user_id AND is_email_verified() = true`.

**Critical Finding**: The `select-payment-provider` function uses `verifyAndGetUser` which authenticates via JWT — the Supabase client uses the user's token. However, the function is called via `payments-provider` which **forwards** the request using `fetch()` with the user's auth header. The forwarded request goes to a different edge function instance where the JWT is validated again. This should work.

BUT — the `is_email_verified()` function in the RLS policy could be failing. If users haven't verified their email, ALL inserts to `payment_attempts` would silently fail via RLS.

### Issue 5: Frontend Silent Failure

The frontend code (Checkout.tsx lines 264-294) wraps the `payments-provider` call in a try-catch. If the function returns an error or the insert fails, it shows a toast but **doesn't redirect**. The order stays in PENDING_PAYMENT/DRAFT with `awaiting_provider_selection`, and the user sees a generic error or nothing happens.

## Proposed Fixes

### Fix 1: Remove `is_email_verified()` Gate from Payment RLS Policies
The `payment_attempts` INSERT policy requiring email verification blocks users who signed up via social login or whose email verification status is unclear. Since the function already validates auth via JWT, this gate is unnecessary and harmful.

```sql
-- Drop restrictive policy
DROP POLICY IF EXISTS "Users can create payment attempts" ON public.payment_attempts;

-- Keep the permissive policy that allows inserts
-- "Users can insert their own payment attempts" with_check: true already exists
```

Also fix `checkout_sessions` which has the same issue:
```sql
DROP POLICY IF EXISTS "Users can create their own checkout sessions" ON public.checkout_sessions;
```

### Fix 2: Add `payment_method` to `payment_attempts` Insert
In `select-payment-provider/index.ts`, add `payment_method` field to the insert:

```typescript
payment_method: provider === 'stripe' ? 'CARD' : 'MOBILE_MONEY',
```

### Fix 3: Add Diagnostic Logging to Frontend Checkout
Add more specific error logging in `Checkout.tsx` to capture exactly what's failing at Step 3.

### Fix 4: Add Update Policy for `payment_attempts`
The `select-payment-provider` function updates `payment_attempts` status after provider API calls (lines 427-433, 594-600), but there's no UPDATE RLS policy visible. Need to add one.

```sql
CREATE POLICY "Users can update their own payment attempts"
ON public.payment_attempts
FOR UPDATE
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);
```

### Fix 5: Add Update Policy for `payments` Table
The `select-payment-provider` function creates records in the `payments` table via `createPaymentRecord`, but the RLS only has SELECT policies — no INSERT or UPDATE. Need to add:

```sql
CREATE POLICY "Users can insert payments for their orders"
ON public.payments
FOR INSERT
TO authenticated
WITH CHECK (EXISTS (
  SELECT 1 FROM orders WHERE orders.id = order_id AND orders.user_id = auth.uid()
));
```

### Fix 6: Verify Webhook Configuration
The Stripe webhook (`payments-webhook`) looks for records in the `payments` table with `provider_key = 'stripe_checkout'` but `select-payment-provider` stores with `provider_key = 'stripe'`. This mismatch means Stripe webhooks can never find the payment record to update the order to PAID.

Fix: align the provider_key values, or add a fallback lookup in the webhook handler.

## Implementation Order

1. **Database migrations** — Fix RLS policies (Issues 1, 4, 5) — this is the blocking issue
2. **Edge function fixes** — Add `payment_method` field, fix `provider_key` mismatch (Issues 3, 6)
3. **Frontend logging** — Better error reporting
4. **Redeploy** `select-payment-provider` and `payments-webhook`
5. **End-to-end test** with a real checkout

## Files to Change

| File | Change |
|------|--------|
| New migration SQL | Drop restrictive RLS, add UPDATE/INSERT policies |
| `supabase/functions/select-payment-provider/index.ts` | Add `payment_method` to insert |
| `supabase/functions/payments-webhook/index.ts` | Fix `provider_key` lookup to include both `stripe` and `stripe_checkout` |
| `src/pages/shop/Checkout.tsx` | Enhanced error logging |

