## What actually happened to Jérémie's payment

Stripe declined the charge with **`card_declined` / "insufficient funds"** on Visa ending **1056** (Order `9b173bd0`, $849.01). Nothing is broken on our side — his card issuer rejected the charge because the account didn't have enough funds. He needs to retry with a different card or top up.

The admin email is generic because the failed-payment notifier (`notifyAllAdminsPaymentEvent` in `supabase/functions/payments-webhook/index.ts`) only receives amount/customer — it never pulls Stripe's `last_payment_error` (which we already save to `payments.failure_code` / `failure_reason`) into the email body.

## Fix

Make the admin "Payment Failed" email specific so we know exactly why without opening Stripe.

1. **Extend `notifyAllAdminsPaymentEvent`** (lines 36–113) to accept an optional `failure` block:
   - `failureCode`, `failureReason`, `declineCode`, `cardBrand`, `cardLast4`, `humanHint`.
2. **At both Stripe failure call-sites** (checkout-expired ~L463–469 and payment_intent.payment_failed ~L649–653):
   - Read `event.data.object.last_payment_error` (`code`, `decline_code`, `message`, `payment_method.card.brand/last4`) for `payment_intent.payment_failed`.
   - For `checkout.session.expired`, pass `failureCode: 'checkout_expired'` + a friendly reason.
   - Map common decline codes to a one-line **What to tell the customer** hint:
     - `insufficient_funds` → "Card had insufficient funds — ask customer to top up or use another card."
     - `card_declined` (generic) → "Issuer declined — customer should contact their bank or try another card."
     - `expired_card` → "Card expired — ask for a new card."
     - `incorrect_cvc` / `incorrect_number` → "Wrong card details — ask customer to re-enter."
     - `do_not_honor`, `generic_decline` → "Issuer blocked the charge — try another card."
     - fallback → use raw Stripe message.
3. **Render in the email** when `status === 'failed'`, replacing the current generic "A payment has failed…" line with a styled block:
   - **Failure reason:** `<humanHint>`
   - **Stripe code:** `<failureCode>` / `<declineCode>`
   - **Stripe message:** `<failureReason>`
   - **Card:** `<cardBrand> •••• <cardLast4>`
   - Keep the red "Open Admin Orders" CTA button.
4. **Subject line:** append the short reason, e.g. `[AfriShop] ❌ Payment Failed — Order 9b173bd0 — Insufficient funds`.
5. Do the same enrichment for the pawaPay failed branch (already has `failureReason.failureMessage` at L726) so mobile-money failures are equally specific.

## Out of scope
- No change to customer-facing emails or retry flow.
- No DB migration — we already store `failure_code` / `failure_reason` on `payments`.
- No edits to the Stripe integration itself.

## Verification
- Trigger a test failure with Stripe test card `4000000000009995` (insufficient_funds) → admin email shows "Insufficient funds — Visa •••• 9995".
- Trigger `4000000000000002` (generic decline) → shows "Issuer declined…".
- Existing success email unchanged.
