

# Fix Payment Path Bugs

## Scope

5 findings reported. 1 is out of scope (iOS native screens not in this repo). 4 are fixable here.

## Bug 1 — P0: iOS PaymentChoiceScreen / PaymentFlowScreen double-payment
**OUT OF SCOPE** — `PaymentChoiceScreen.tsx` and `PaymentFlowScreen.tsx` do not exist in this web project. They are in the separate React Native mobile repo. No action here.

## Bug 2 — P0: stripe-verify marks paid on `status === 'complete'` alone

**File**: `supabase/functions/stripe-verify-checkout-session/index.ts` line 235

**Problem**: `stripeStatus === 'complete'` does NOT guarantee payment was captured — it only means the checkout flow finished. A session can be `complete` with `payment_status = 'unpaid'` (e.g. delayed payment methods).

**Fix**: Change line 235 from:
```
if (paymentStatus === 'paid' || stripeStatus === 'complete')
```
to:
```
if (paymentStatus === 'paid')
```
Only `payment_status === 'paid'` is a safe signal that funds were captured.

## Bug 3 — P0: No idempotency in stripe-create-checkout-session

**File**: `supabase/functions/stripe-create-checkout-session/index.ts`

**Problem**: Every call creates a new Stripe Checkout Session + payments row. Double taps or retries create multiple live chargeable sessions for one order.

**Fix**: Before creating a new Stripe session (before line 189), check for an existing `payments` row with `provider_key = 'stripe_checkout'`, `status = 'pending'`, and matching `order_id`. If found, retrieve the Stripe session via API to check if it's still active (`status !== 'expired'`). If active, return the existing `checkout_url` instead of creating a new session.

## Bug 4 — P1: Reference UUID truncated at first hyphen

**File**: `supabase/functions/payment-status/index.ts` line 130

**Problem**: `reference.replace('AFRISHOP-', '').split('-')[0]` truncates a UUID (which contains hyphens) to just its first segment.

**Fix**: Use the full remaining string after removing the prefix. The reference format per `formatOrderId.ts` is `AFRI-{NAME}-{shortId}`, not `AFRISHOP-{uuid}`. But since UUIDs may be passed directly, the safest fix is: if the extracted value looks like a UUID prefix, query with `.ilike('id', extractedOrderId + '%')`, or better, just remove the `AFRISHOP-` prefix and use the full remainder without splitting on `-`.

## Bug 5 — P1: Old PaymentSuccess.tsx calls payment-status without auth

**File**: `src/pages/PaymentSuccess.tsx` (the legacy route, NOT `src/pages/shop/PaymentSuccess.tsx`)

**Problem**: Calls `/functions/v1/payment-status` with only `apikey` header — no JWT. The endpoint now requires auth for `order_id`/`reference` lookups.

**Fix**: Use `supabase.functions.invoke('payment-status', ...)` which automatically includes the user's JWT. If no session exists, skip the status call and show a generic success (same pattern as `shop/PaymentSuccess.tsx` line 35-41).

## Implementation order

1. Fix `stripe-verify-checkout-session` — 1 line change (Bug 2)
2. Fix `payment-status` reference extraction — 1 line change (Bug 4)
3. Fix `PaymentSuccess.tsx` to use authenticated call (Bug 5)
4. Add idempotency guard to `stripe-create-checkout-session` (Bug 3)

## Technical detail

All fixes are in edge functions + one frontend page. No database migrations needed.

