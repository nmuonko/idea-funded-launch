

# Referral System: Switch from Data Rewards to Sales Commission

## What Changes

The current referral system rewards referrers when someone **signs up and verifies email**. The new system rewards referrers with a **percentage of each purchase** made by people who used their referral link.

## Database Changes

### New table: `referral_commissions`
Tracks each commission earned per order:
- `id`, `referrer_id` (FK referrers), `order_id` (FK orders), `buyer_user_id`
- `order_total_usd`, `commission_percent`, `commission_amount_usd`
- `status` (pending/approved/paid), `created_at`, `paid_at`

### New row in `admin_settings`
- Key: `REFERRAL_COMMISSION_PERCENT`, Value: `10` (default 10%, admin-adjustable)

### Drop/disable old payout infrastructure
- Remove `referral_payout_rules` data (data/airtime reward rules)
- Remove `referral_payout_claims` data
- Keep tables for historical reference but stop using them

## Backend Changes

### 1. Trigger commission on payment confirmation
In the webhook/callback functions that mark orders as PAID (`payments-webhook`, `pawapay-callback`, `payment-callback`, `stripe-verify-checkout-session`, `mobile-verify-payment`), add a server-to-server call to a new action in `auth-service` (or a small dedicated function) that:
1. Looks up `profiles.referred_by_code` for the buyer
2. Finds the referrer in `referrers` table
3. Reads `REFERRAL_COMMISSION_PERCENT` from `admin_settings`
4. Inserts a row into `referral_commissions` with the calculated amount
5. Deduplicates by `(order_id, referrer_id)` unique constraint

This is a fire-and-forget call so it doesn't block payment confirmation.

### 2. Remove `referral-on-verify` trigger
- Remove the call from `auth-service` signup flow and `EmailConfirmed.tsx`
- The function can stay deployed but won't be called

## Frontend Changes

### 1. Update `InviteEarn` component
- Change description from "verify email = reward" to "when your friend buys, you earn commission"
- Keep the registration and link-sharing flow identical

### 2. Rebuild Admin Referrals page
Replace the Rules & Config tab with a **Commission Settings** section:
- Single input: "Commission %" (reads/writes `REFERRAL_COMMISSION_PERCENT` in `admin_settings`)
- Remove data/airtime/Reloadly reward type selectors

Replace the Payouts tab with a **Commissions** tab:
- Table showing: referrer name, order ID, order total, commission %, commission amount, status
- "Mark Paid" button for pending commissions
- Stats: total commissions earned, total paid out, pending

### 3. Update stats cards
- Replace "Verified" with "Purchases" (count of orders with commissions)
- Replace "Pending Payouts" with "Pending Commissions" (sum of unpaid commission amounts)

## Files Affected

| File | Change |
|------|--------|
| `supabase/functions/payments-webhook/index.ts` | Add commission trigger after PAID |
| `supabase/functions/pawapay-callback/index.ts` | Add commission trigger after PAID |
| `supabase/functions/payment-callback/index.ts` | Add commission trigger after PAID |
| `supabase/functions/stripe-verify-checkout-session/index.ts` | Add commission trigger after PAID |
| `supabase/functions/mobile-verify-payment/index.ts` | Add commission trigger after PAID |
| `supabase/functions/auth-service/index.ts` | Remove referral-on-verify call from signup; add `create_referral_commission` action |
| `src/pages/EmailConfirmed.tsx` | Remove `triggerReferralReward` call |
| `src/components/shop/InviteEarn.tsx` | Update copy to mention purchase-based commission |
| `src/pages/admin/Referrals.tsx` | Rebuild with commission settings + commission table |
| New migration | Create `referral_commissions` table + insert default commission % |

