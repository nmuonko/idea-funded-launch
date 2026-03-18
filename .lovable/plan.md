## Checkout Payment Fix — Zero Purchases (Complete)

### Problem
53 checkout sessions stuck at `awaiting_provider_selection` with 0 payment attempts. Step 3 (`payments-provider` call) silently fails on mobile WebView.

### Changes Made

#### 1. Merged Steps 2+3 into Single Backend Call (Primary Fix)
- **`mobile-checkout/index.ts`**: After creating checkout session, if `provider`, `phone`, `operator` are in the request body, calls `select-payment-provider` server-to-server inline
- Returns PawaPay USSD confirmation or Stripe `clientSecret` directly — no separate frontend call needed
- Falls back to `awaiting_provider_selection` if inline call fails (backward compatible with mobile app)

#### 2. Updated Frontend Flow
- **`Checkout.tsx`**: Now passes `provider`, `phone`, `operator` in the checkout payload
- Handles inline provider response directly (pawapay → `/payment-pending`, stripe → `/card-payment`)
- Keeps fallback path for old backend or if inline fails
- Added visible error banner with "Retry" button (replaces silent toast-only errors)
- Added `checkoutError` state for persistent error display

#### 3. Checkout Funnel Analytics
- Created `checkout_funnel_log` table: `(id, user_id, session_id, step, status, error_message, metadata, created_at)`
- Frontend logs: `order_created`, `checkout_started`, `payment_initiated`, `provider_failed`, `provider_exception`
- RLS policies for authenticated users + service role

### Result
| Before | After |
|--------|-------|
| 3 frontend API calls (any can fail silently) | 2 calls, provider handled server-side |
| Silent toast on failure | Visible error banner + Retry button |
| 0 payment tracking | Full funnel analytics |

---

## Backend Cost Optimization (Complete)

### Problem
~$480 in ~1.5 months on Cloud/AI.

### Changes Made
- Removed redundant AI calls, dual-provider race
- Changed cron from */10 to */30 minutes
- Deleted 35 unused edge functions
- Extended cache TTLs
- Added 500 calls/day AI budget cap

### Estimated Savings: $170-240/month (35-50% reduction)

---

## Referral System: Sales Commission Model (Complete)

### Problem
Old system rewarded data/airtime when referred users verified email — zero engagement (2 referrers, 0 payouts).

### Changes Made

#### 1. Database
- Created `referral_commissions` table: `(referrer_id, order_id, buyer_user_id, order_total_usd, commission_percent, commission_amount_usd, status, paid_at)`
- Added `REFERRAL_COMMISSION_PERCENT` admin setting (default 10%)

#### 2. Backend — Commission on Payment
- Created `_shared/referralCommission.ts` helper: looks up buyer's `referred_by_code`, finds referrer, calculates commission, inserts with dedup
- Wired into all 5 payment confirmation paths: `payments-webhook`, `pawapay-callback`, `payment-callback`, `stripe-verify-checkout-session`, `mobile-verify-payment`
- Fire-and-forget — never blocks payment flow

#### 3. Frontend
- **InviteEarn.tsx**: Updated copy from "verify email = reward" → "friend buys = commission" (all 4 languages)
- **EmailConfirmed.tsx**: Removed `triggerReferralReward` call (no more data/airtime on verify)
- **Admin Referrals**: Complete rebuild — commission settings, commissions table with "Mark Paid", purchase-based stats
