

# Fix Remaining MaishaPay References in Admin Dashboard

## Fix 1: admin/Orders.tsx (line 689) -- One-line change

Remove the legacy `maisha_payment_status` fallback from the bulk receipt eligibility check.

**Change line 689 from:**
```
selectedOrders.has(o.id) && (paidStatuses.includes(o.status) || o.maisha_payment_status === 'SUCCESS')
```
**To:**
```
selectedOrders.has(o.id) && paidStatuses.includes(o.status)
```

## Fix 2: PaymentsBreakdown.tsx -- Full rewrite of data layer

Replace the `maisha_payments` table query with `payment_attempts` and update the revenue breakdown to show PawaPay and Stripe separately.

### Interface change
Replace `maishaPayRevenue: number` with `pawapayRevenue: number` and `stripeRevenue: number`.

### Data loading change
- Query `payment_attempts` table (columns: `status`, `amount`, `provider`) with optional `dateRange` filtering on `created_at`
- Successful = `status in ('paid', 'success')`
- Failed = `status in ('failed', 'expired')`
- Revenue split by `provider === 'pawapay'` vs `provider === 'stripe'`

### UI change
- "Mobile Money" label becomes "PawaPay" showing `pawapayRevenue`
- "Other" label becomes "Stripe" with a blue dot, showing `stripeRevenue`

## Execution Order

1. Fix `admin/Orders.tsx` line 689
2. Rewrite `PaymentsBreakdown.tsx`
