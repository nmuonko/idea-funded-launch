

# Payment Flow Audit and Hardening Plan

## Summary

After a thorough review of the entire payment pipeline -- from checkout initiation through webhook finalization -- the architecture is solid with proper idempotency, signature verification, and provider fallback. However, I found **5 bugs/risks** that need fixing to ensure reliable payment on both web and mobile.

---

## Issues Found

### 1. Dead/Unreachable Code in `payments-webhook` (Bug)
In `supabase/functions/payments-webhook/index.ts`, lines 131-136 contain a duplicate `default` case block after a `return` statement, making it unreachable dead code. While not a functional bug, it indicates copy-paste drift and should be cleaned up.

### 2. Wrong Route in Stripe Card Payment Error Page (Bug - Web)
In `src/pages/shop/CardPayment.tsx` line 311, the "Back to Cart" button navigates to `/shop/cart` instead of `/cart`. This means users who hit a card payment error get sent to a 404 page.

### 3. Premature Failure Detection in PaymentPending (Bug - Web + Mobile)
In `src/pages/shop/PaymentPending.tsx` line 54, if the order status is `DRAFT`, the page immediately shows "Payment Failed". However, there's a race condition: the order may still be transitioning from `DRAFT` to `PENDING_PAYMENT` (the backend updates this asynchronously in `select-payment-provider`). This can cause false failure screens.

### 4. Missing Idempotency Guard on pawaPay Webhook Order Update (Risk - Duplicate)
In `payments-webhook/index.ts` line 527-535, the pawaPay handler updates the order to `PAID` without first checking if it's already `PAID` (unlike the Stripe checkout handler which checks on line 281). If pawaPay sends duplicate callbacks, this could trigger duplicate email notifications.

### 5. Missing Idempotency Guard on Stripe PaymentIntent Webhook Order Update (Risk - Duplicate)
In `payments-webhook/index.ts` lines 417-430, the Stripe PaymentIntent handler updates the order to `PAID` without checking current status first. Same risk as issue 4.

---

## Fixes

### Fix 1: Remove dead code in payments-webhook
Remove the duplicate unreachable `default` case (lines 131-136) in `payments-webhook/index.ts`.

### Fix 2: Correct CardPayment error route
Change `/shop/cart` to `/cart` in `src/pages/shop/CardPayment.tsx` line 311.

### Fix 3: Harden PaymentPending status detection
In `src/pages/shop/PaymentPending.tsx`, instead of marking as failed immediately on `DRAFT`, add `DRAFT` to a "still waiting" state and only mark as failed after a timeout (e.g., 60 seconds of DRAFT means the payment initiation failed). Also add `CANCELLED` and `REJECTED` to the failure conditions.

### Fix 4: Add idempotency guard to pawaPay webhook order update
In `payments-webhook/index.ts`, before updating order to `PAID` in the pawaPay handler, check if the order is already in a terminal state (`PAID`, `COMPLETED`, `SHIPPED`). Skip the update if so.

### Fix 5: Add idempotency guard to Stripe PaymentIntent webhook order update
Same fix as 4, but for the Stripe PaymentIntent handler section.

---

## Files Modified

| File | Change |
|------|--------|
| `supabase/functions/payments-webhook/index.ts` | Remove dead code; add idempotency guards for both pawaPay and Stripe PI handlers |
| `src/pages/shop/CardPayment.tsx` | Fix `/shop/cart` to `/cart` |
| `src/pages/shop/PaymentPending.tsx` | Fix premature DRAFT failure; add proper timeout logic |

---

## What This Does NOT Change

- No changes to `select-payment-provider` (idempotency already solid)
- No changes to `mobile-checkout` (session locking works correctly)
- No changes to `mobile-verify-payment` (provider fallback is correct)
- No changes to `pawapay-callback` (signature verification is thorough)
- No database schema changes needed

