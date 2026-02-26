
## Go-Live QA Audit Results

### PASSED (No Action Needed)

1. **Payment Edge Functions** -- All respond with proper structured JSON (HTTP 200 with `{ ok: false, error, message }`) for invalid/unauthenticated requests. No raw errors leak to clients.
2. **Payment Callback Flow** -- `/payment-callback` correctly polls `mobile-verify-payment` and redirects to `/payment-success-shop` on success. Handles timeout, network errors, and failure states with bilingual messages.
3. **Payment Success Page** -- `/payment-success-shop` verifies order status via DB polling, clears cart only on confirmed PAID status, uses `cartClearedRef` to prevent double-clearing.
4. **Stripe Redirect URLs** -- `CardPayment.tsx` uses `window.location.origin` for `return_url`, ensuring correct redirects in both preview and production environments.
5. **Account Creation** -- `auth-register` validates required fields (country). Profile auto-creation trigger (`handle_new_user_profile`) correctly upserts profiles with SSO metadata extraction. All 20 profiles have email and user_id populated.
6. **Cart Sync** -- Cart context has sync lock, deduplication, optimistic rollback, and deletion resilience via sessionStorage TTL.
7. **Idempotency** -- `finalize_paid_order` uses `FOR UPDATE` row locking and returns idempotent success for already-PAID orders. `select-payment-provider` checks `payment_attempts` for existing pending/paid status.
8. **Edge Function Health** -- Zero 5xx errors in the last 24 hours. No database-level ERROR/FATAL/PANIC entries.
9. **RLS Coverage** -- No tables with RLS disabled (the `amazon_ingest_queue` fix from Round 2 is in effect). All critical tables (orders, profiles, payments) have proper user-scoped policies.

### ISSUES FOUND (Recommended Fixes)

#### Issue 1: 14 Stale PENDING_PAYMENT Orders (Data Hygiene)
14 orders are stuck in `PENDING_PAYMENT` status with no active payment attempts, some as old as 31 days. The `cleanup_all_expired_data()` function expires pending `payment_attempts` but never transitions the parent order status. These ghost orders clutter the system.

**Fix**: Add a step to `cleanup_all_expired_data()` that marks PENDING_PAYMENT orders as CANCELLED if they have no active payment attempts and are older than 48 hours.

#### Issue 2: 3 Empty DRAFT Orders (Data Hygiene)
3 DRAFT orders exist with zero items. These are abandoned carts that will never convert.

**Fix**: Add a step to `cleanup_all_expired_data()` to delete DRAFT orders with 0 items older than 7 days.

#### Issue 3: `update_runtime_config_version` Function Missing `search_path` (Security)
This trigger function has no `search_path` set and is not `SECURITY DEFINER`, making it vulnerable to search path injection. The linter flags this as WARN.

**Fix**: Recreate the function with `SECURITY DEFINER SET search_path TO 'public'`.

#### Issue 4: 2 Tables with RLS Enabled but No Policies (Minor)
- `catalog_home_mobile_sections_cache`
- `search_rewrite_cache`

These tables block all access (including service role via PostgREST anon key). If edge functions write to them, they silently fail.

**Fix**: Add service-role-only policies to both tables.

### Summary

| Area | Status |
|------|--------|
| Payments (Stripe + PawaPay) | PASS |
| Payment Redirects | PASS |
| Cart Sync + Clearing | PASS |
| Account Creation + Profiles | PASS |
| Auth Redirects (email verify) | PASS |
| Idempotency (double-charge prevention) | PASS |
| Edge Function Health (0 errors) | PASS |
| RLS Security | PASS (minor fixes below) |
| Stale Order Cleanup | FIX NEEDED |
| Function Search Path | FIX NEEDED |
| Missing RLS Policies | FIX NEEDED |

### Implementation Plan

Single migration to address the 4 issues:

```sql
-- 1. Fix stale PENDING_PAYMENT orders
UPDATE orders SET status = 'CANCELLED', updated_at = now()
WHERE status = 'PENDING_PAYMENT'
AND created_at < now() - interval '48 hours'
AND NOT EXISTS (
  SELECT 1 FROM payment_attempts pa 
  WHERE pa.order_id = orders.id AND pa.status IN ('pending', 'paid')
);

-- 2. Delete empty DRAFT orders older than 7 days
DELETE FROM orders WHERE status = 'DRAFT'
AND created_at < now() - interval '7 days'
AND NOT EXISTS (SELECT 1 FROM order_items oi WHERE oi.order_id = orders.id);

-- 3. Fix function search_path
CREATE OR REPLACE FUNCTION public.update_runtime_config_version()
RETURNS trigger LANGUAGE plpgsql
SECURITY DEFINER SET search_path TO 'public'
AS $$ BEGIN
  NEW.version := (EXTRACT(EPOCH FROM now()) * 1000)::bigint;
  NEW.updated_at := now();
  RETURN NEW;
END; $$;

-- 4. Add missing RLS policies
CREATE POLICY "Service role only" ON public.catalog_home_mobile_sections_cache
  FOR ALL USING (false) WITH CHECK (false);
CREATE POLICY "Service role only" ON public.search_rewrite_cache
  FOR ALL USING (false) WITH CHECK (false);

-- 5. Enhance cleanup_all_expired_data to auto-cancel stale orders going forward
-- (add order cancellation + empty draft cleanup steps)
```

### Verdict
**You are good to go live.** The core flows (payments, redirects, cart, auth) are all working correctly. The 4 issues above are data hygiene and hardening improvements -- none are blockers for launch.
