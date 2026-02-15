

# Remove Unwanted Payment Providers (Keep Only PawaPay + Stripe)

## What Changes

The payment providers table currently has 5 entries. We will remove 3 (MaishaPay, Bank Transfer, AvadaPay) so only **PawaPay** and **Stripe** remain.

## Steps

### 1. Delete unwanted rows from `payment_providers` table
Run a database migration to delete `maishapay`, `bank_transfer`, and `avadapay` from the `payment_providers` table on Test. After publish, you will also need to run the same DELETE on Live.

```sql
DELETE FROM payment_providers 
WHERE provider_key IN ('maishapay', 'bank_transfer', 'avadapay');
```

### 2. Simplify `getAllProviders` filter
Update `supabase/functions/_shared/paymentProviders.ts` to remove the `.neq('provider_key', 'maishapay')` filter since MaishaPay no longer exists. The function will just return all rows (which will be only PawaPay and Stripe).

### 3. Manual step for Live
After publishing, run this SQL on the **Live** environment (Cloud View, Run SQL, Live selected):

```sql
DELETE FROM payment_providers 
WHERE provider_key IN ('maishapay', 'bank_transfer', 'avadapay');
```

## Result
- The Payment Settings admin page will only show PawaPay and Stripe
- No other providers will appear in the checkout flow
- Existing edge function adapters (avadapayAdapter, etc.) remain in code but are never called since no provider record exists to route to them

## Files Changed

| File | Change |
|------|--------|
| Database migration (new) | DELETE 3 provider rows |
| `supabase/functions/_shared/paymentProviders.ts` | Remove `.neq('provider_key', 'maishapay')` filter |

