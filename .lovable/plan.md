

# Referral Commission: Notifications + Automated Mobile Money Payouts

## What You'll Get

1. **Referrers get an email** every time someone they referred makes a purchase (with order details and commission earned)
2. **Automated payouts** via PawaPay to referrers' Airtel/Orange/Vodacom wallets when their balance hits $5+
3. **Admin toggle** in the Referrals settings to switch between "Fully Automatic" and "One-Click Approval" payout modes
4. **One-click "Pay Now"** button in admin dashboard that triggers the PawaPay payout instantly

## Database Changes

### New table: `referral_payouts`
Tracks each mobile money payout sent:
- `id`, `referrer_id`, `amount_usd`, `phone`, `correspondent`, `pawapay_payout_id`
- `status` (pending/completed/failed), `commission_ids` (array of commission IDs included)
- `created_at`, `completed_at`, `failure_reason`

### New admin settings keys
- `REFERRAL_PAYOUT_MODE` — `automatic` or `manual` (default: `manual`)
- `REFERRAL_PAYOUT_MIN_USD` — minimum balance before payout (default: `5`)

## Backend Changes

### 1. Commission notification email
In `_shared/referralCommission.ts`, after successfully inserting a commission, send an email to the referrer via the existing `email-service` with:
- Referrer name, the order total, their commission amount, and running total balance
- Bilingual (French-first, matching the app's pattern)

### 2. New edge function: `referral-payout`
Handles payout execution:
- **Action `process`**: Called after commission is created (if mode = `automatic`) or by admin click (if mode = `manual`)
- Aggregates all `pending` commissions for a referrer, checks if total >= minimum threshold
- Calls PawaPay `POST /v2/payouts` with the referrer's phone number (already stored in `referrers.phone`)
- Uses the existing `detectCorrespondent` and `formatPhoneE164` helpers from `pawapayAdapter.ts`
- Inserts a `referral_payouts` record, then updates the included commissions to `status: paid`

### 3. PawaPay payout callback
Add a `referral-payout-callback` endpoint (or handle in existing `pawapay-callback`) to receive payout status updates from PawaPay:
- On `COMPLETED`: mark `referral_payouts.status = completed`, update commissions to `paid`
- On `FAILED`: mark payout as failed, revert commissions back to `pending`

### 4. Trigger flow
In `_shared/referralCommission.ts`, after inserting commission:
1. Send notification email to referrer
2. If `REFERRAL_PAYOUT_MODE = automatic`: call `referral-payout` to attempt auto-payout
3. If `manual`: do nothing (admin clicks "Pay Now" later)

## Frontend Changes

### Admin Referrals page (`src/pages/admin/Referrals.tsx`)

**Settings tab** — add:
- **Payout Mode** toggle: "Automatic" vs "One-Click Approval"
- **Minimum Payout** input: defaults to $5

**Commissions tab** — update:
- Replace "Mark Paid" with **"Pay Now"** button that triggers the PawaPay payout via the edge function
- Show payout status (pending → sending → completed/failed)
- Add a "Payouts" sub-section showing payout history with PawaPay transaction IDs

## Files Affected

| File | Change |
|------|--------|
| New migration | `referral_payouts` table + new admin settings |
| `supabase/functions/referral-payout/index.ts` | New — executes PawaPay payout |
| `supabase/functions/_shared/referralCommission.ts` | Add email notification + auto-payout trigger |
| `supabase/functions/pawapay-callback/index.ts` | Handle payout callbacks |
| `src/pages/admin/Referrals.tsx` | Add payout mode toggle, min payout, "Pay Now" button, payout history |

