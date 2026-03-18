

# Fix: Payments Stuck at "awaiting_provider_selection" — Zero Purchases

## Root Cause Analysis

The data is definitive:
- **53 checkout sessions** created with `status: awaiting_provider_selection` — `mobile-checkout` works fine
- **0 payment_attempts** records — `select-payment-provider` is NEVER reached
- **0 logs** for `payments-provider` or `select-payment-provider` — the frontend call silently fails

The checkout is a 3-step process on the frontend (Checkout.tsx):
1. `mobile-orders` → `action: 'create'` → creates DRAFT order (works)
2. `mobile-orders` → `action: 'checkout'` → creates checkout session (works — 53 sessions exist)
3. `payments-provider` → `action: 'select'` → calls PawaPay/Stripe (**NEVER REACHED**)

Step 3 (line 267) calls `supabase.functions.invoke('payments-provider', ...)`. If this throws, the catch block (line 283) shows a toast and silently returns. On mobile WebView, users likely never see the toast. They tap "Place Order," see a brief spinner, then nothing happens. They leave.

**Why step 3 fails silently:**
The `supabase.functions.invoke` can fail due to network issues, CORS preflight failures on certain mobile WebViews, or the response parsing failing. The error is caught on line 283 and swallowed with just a toast notification. There's no retry, no fallback, and no visible error state on the page.

## Plan

### 1. Merge Steps 2 and 3 into a Single Backend Call (Primary Fix)

The 3-step frontend flow is fragile — any failure between steps loses the payment. Merge steps 2+3 so that `mobile-checkout` directly calls PawaPay/Stripe when the payment method is known upfront.

**Changes to `supabase/functions/mobile-checkout/index.ts`:**
- Accept `provider` and `phone`/`operator` fields in the request body
- After creating the checkout session, if `provider` is specified, call `select-payment-provider` logic inline (or call it server-to-server)
- Return the PawaPay USSD confirmation or Stripe `clientSecret` directly — no second frontend call needed

**Changes to `src/pages/shop/Checkout.tsx`:**
- Pass `provider: 'pawapay'`/`'stripe'`, `phone`, and `operator` in the checkout payload (line 199-202)
- Remove the entire step 3 block (lines 227-331) — the response from step 2 will already contain the payment initiation result
- Handle `pending_user_confirmation` (PawaPay) and `clientSecret` (Stripe) directly from the checkout response

### 2. Add Visible Error State (Safety Net)

Even with the merged flow, add a visible error state so users know something failed:

**Changes to `src/pages/shop/Checkout.tsx`:**
- Add a `checkoutError` state that renders a red banner on the checkout page (not just a toast)
- Show a "Retry Payment" button when the error occurs
- Log the error to `checkout_sessions.metadata` so you can see failures in the admin dashboard

### 3. Add Checkout Analytics Logging

**New database migration:**
- Add a `checkout_funnel_log` table: `(id, user_id, session_id, step, status, error_message, created_at)`
- Log each step (order_created, checkout_started, provider_selected, payment_initiated) so you can see exactly where users drop off

### Summary

The fix collapses a fragile 3-step frontend process into a single backend call. Instead of the frontend making 3 separate API calls (any of which can fail silently on mobile), the user taps "Place Order" once and the backend handles everything — returning either a PawaPay USSD push confirmation or a Stripe payment link.

| Before | After |
|--------|-------|
| Frontend: create → checkout → select-provider (3 calls) | Frontend: create → checkout+pay (2 calls) |
| Step 3 fails silently, user sees nothing | Backend handles payment inline, errors shown visibly |
| 0/53 payments completed | Single point of failure with retry |

