

# Fix Remaining MaishaPay References in Admin Dashboard

## Issues Found

### 1. PaymentsBreakdown.tsx -- Still queries maisha_payments table

**File:** `src/components/admin/dashboard/PaymentsBreakdown.tsx`

The admin dashboard payments breakdown widget still:
- Queries the `maisha_payments` table for payment stats (lines 42-45)
- Queries `maisha_transaction_id` from orders (line 52)
- Calculates `maishaPayRevenue` based on `maisha_transaction_id` (lines 65-68)

**Fix:** Rewrite to use `payment_attempts` table instead:
- Query `payment_attempts` for total/successful/failed counts
- For revenue breakdown, use `payment_attempts.provider` to distinguish PawaPay vs Stripe revenue
- Remove `maishaPayRevenue` field, replace with `pawapayRevenue` and `stripeRevenue`

### 2. admin/Orders.tsx line 689 -- Legacy maisha_payment_status check

**File:** `src/pages/admin/Orders.tsx`, line 689

The bulk receipt download eligibility check still includes `o.maisha_payment_status === 'SUCCESS'` as a fallback for detecting paid orders.

**Fix:** Remove the `|| o.maisha_payment_status === 'SUCCESS'` condition. The `paidStatuses` array already covers all valid paid statuses via `o.status`.

## Changes

### PaymentsBreakdown.tsx (full rewrite of data loading)

- Replace `maisha_payments` query with `payment_attempts` query
- Change interface: replace `maishaPayRevenue` with `pawapayRevenue` and `stripeRevenue`
- Update revenue breakdown UI to show "PawaPay" and "Stripe" instead of "Mobile Money" and "Other"
- Query payment_attempts with `status in ('paid', 'success')` for successful payments
- For revenue, join with orders or use payment_attempts amount directly

### admin/Orders.tsx (one-line fix)

- Line 689: Change from:
  ```
  selectedOrders.has(o.id) && (paidStatuses.includes(o.status) || o.maisha_payment_status === 'SUCCESS')
  ```
  to:
  ```
  selectedOrders.has(o.id) && paidStatuses.includes(o.status)
  ```

## Execution Order

1. Fix `admin/Orders.tsx` line 689 (one-line change)
2. Rewrite `PaymentsBreakdown.tsx` to use `payment_attempts` table

