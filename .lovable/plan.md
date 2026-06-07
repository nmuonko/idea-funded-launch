# 30% Deposit / 70% on Arrival — Payment Plan

A new opt-in payment plan on checkout. Default stays full payment, so nothing breaks for existing flows.

## Eligibility rules (enforced server-side)
- **Allowed**: any cart/hot product whose total is **≥ $100 USD** and contains **no vehicle** items.
- **Blocked**: cars (uses existing `contains_vehicle` flag + vehicle detection), and orders under $100.
- The UI only shows the deposit toggle when eligible. The intent-creation endpoint re-validates eligibility before accepting `plan = 'deposit'` so the client can't bypass.

## Customer experience
1. On the cart checkout page (`Checkout.tsx`) and the hot product buy page (`HotProductBuy.tsx`), when eligible, show a radio toggle:
   - ⚪ Pay full now — `$X`
   - ⚪ Pay 30% deposit now (`$0.3X`), 70% on arrival (`$0.7X`)
2. Selection is saved with the order. If "deposit" is chosen, the payment provider charges only the deposit amount using the **same provider** as before (Stripe / pawaPay / MaishaPay).
3. After the deposit succeeds, the order becomes `PAID_DEPOSIT` (new sub-status) and shows a clear "Deposit paid · Balance due on arrival" badge in the customer's order history.
4. When admin marks the order **SHIPPED**, an automatic email reminder is sent to the customer with a link to pay the 70% balance via the same provider used for the deposit.
5. Customer pays the balance through that link → order becomes fully `PAID` and proceeds normally.

## Admin experience
- Order list & detail show a "Deposit · $X paid / $Y due" badge and the balance status (Pending / Paid).
- Order detail gets a **"Send balance reminder"** button (manual resend) and shows the generated balance link.
- Receipts already exist; balance payments add a second receipt entry once collected.

## Database (one migration, additive only)
New nullable columns on `orders` — existing orders are unaffected:
- `payment_plan` text default `'full'` — values: `'full' | 'deposit'`
- `deposit_amount_usd` numeric
- `balance_amount_usd` numeric
- `balance_status` text — `'not_applicable' | 'pending' | 'paid'` (default `'not_applicable'`)
- `balance_paid_at` timestamptz
- `balance_payment_id` uuid (FK to `payments.id`)
- `balance_reminder_sent_at` timestamptz
- `balance_payment_reference` text (the provider session/deposit id for the balance charge)

New order status value: `'PAID_DEPOSIT'` added to the `order_status` enum (between `PAID` and `PROCESSING` semantically). All existing status checks that look for `PAID` are widened where appropriate (admin can still ship a deposit-paid order; full-paid filters stay unchanged).

## Backend changes
- **`payments-create-intent`** (and the two provider-specific creators: `stripe-create-checkout-session`, `pawapay-create-payment`): accept optional `plan: 'full' | 'deposit'`. When `deposit`, re-validate eligibility against the order, compute `deposit = round_up(total * 0.30)`, `balance = total - deposit`, charge the deposit, and persist plan + amounts on the order.
- **Webhooks** (`payments-webhook`, `pawapay-callback`, `stripe-verify-checkout-session`, `maisha-callback`): when a successful payment maps to an order with `payment_plan='deposit'` and the reference is the **deposit** reference, set status `PAID_DEPOSIT`, `balance_status='pending'`. When it's the **balance** reference, set `balance_status='paid'`, `balance_paid_at`, and promote status to `PAID` (then existing auto-progression to PROCESSING runs as today).
- **New edge function `create-balance-payment`**: generates a fresh provider checkout session for the 70% balance using the same provider as the deposit; idempotent per order.
- **New edge function `send-balance-reminder`** (uses existing email infra): sends "Your order has arrived — pay the balance" email containing the balance link. Triggered automatically when an admin transitions an order with `balance_status='pending'` to `SHIPPED`, and manually from the admin button.

## Frontend changes (presentation only)
- `Checkout.tsx`: add `PaymentPlanSelector` component shown when eligible; pass `plan` to intent creation.
- `HotProductBuy.tsx`: same selector when hot product price ≥ $100.
- `MyOrders.tsx` / customer order detail: show deposit badge + "Pay balance now" button when `balance_status='pending'` and a balance link exists.
- Admin `OrderDetail.tsx`: deposit/balance card + "Send balance reminder" action.
- New tiny `PaymentPlanBadge` component reused in customer and admin views.

## No-regression guardrails
- All new columns are nullable with safe defaults; existing orders read `payment_plan='full'` implicitly.
- The deposit path is fully opt-in client-side AND re-validated server-side; the default code path for full payment is untouched.
- Webhook handlers branch on `payment_plan` and the reference shape (`AFRISHOP-{orderId}-DEPOSIT-…` vs `AFRISHOP-{orderId}-BALANCE-…`) so existing single-payment orders go through the same branch as today.
- Cars (`contains_vehicle = true` or vehicle detection on items) are hard-blocked at both UI and API levels.
- Auto-cancellation of pending orders remains disabled (per prior fix) — deposit-paid orders are explicitly excluded anyway.

## Out of scope
- No change to refund logic for deposit orders in this pass (refunds remain admin-manual, same flow). Will revisit if you ask.
- No partial-refund of just the deposit; if needed later we can add it.

Shall I proceed with implementation?
