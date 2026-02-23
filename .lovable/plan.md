

# Regression Fixes for Stripe and PawaPay Payment Flows

## Issues Found

### 1. CRITICAL: `verify-payment` crashes on failed payments (undefined variable)

**File:** `supabase/functions/verify-payment/index.ts`, line 333

The failed/cancelled payment response references `maishapayStatus` -- a variable that was removed during the MaishaPay cleanup. This means any failed PawaPay or Stripe payment verification will crash the function with a `ReferenceError`.

**Fix:** Replace `paymentStatus: maishapayStatus` with `paymentStatus: normalizedStatus` (the local variable already computed on line 256).

### 2. CRITICAL: Stripe card payment redirects to non-existent route

**File:** `src/pages/shop/CardPayment.tsx`, lines 121 and 133

After a successful Stripe card payment, the user is redirected to `/shop/payment-success?order_id=...`. However, there is **no route** matching `/shop/payment-success` in `App.tsx`. The route is at `/payment-success-shop`.

This means:
- After successful Stripe card payment, users see a blank page / 404
- For 3D Secure redirects (where Stripe uses `return_url`), users land on a non-existent page

**Fix:** Change both redirect URLs in `CardPayment.tsx` from `/shop/payment-success` to `/payment-success-shop`.

### 3. LOW: Leftover MaishaPay/bank transfer references in translations

**File:** `src/lib/i18n/translations.ts`

Multiple translation strings still reference "MaishaPay" and "bank transfer":
- `payments.subtitle`: "Track and manage MaishaPay transactions" (en/fr/sw/ln)
- `payments.transactionsDesc`: "View and manage MaishaPay payment records"
- `payments.maishaPayRef`: "MaishaPay Ref"
- `onboardingStep2Desc`: mentions "Bank Transfer"
- `howItWorks2Desc`: mentions "bank transfer"
- `admin.bankTransferSettings`: "Bank Transfer"

**Fix:** Update these strings to reference "PawaPay and Stripe" or generic "payment" terminology.

### 4. LOW: Leftover legacy paths in environment.ts

**File:** `src/lib/environment.ts`, line 31

The `excludedPaths` array still contains `/bank-transfer`, `/manual-transfer`, `/maishapay`. These are harmless (the pages don't exist, so they'll just 404), but should be cleaned up.

**Fix:** Remove `/bank-transfer`, `/manual-transfer`, `/maishapay` from the `excludedPaths` array.

## What is NOT broken (confirmed working)

- **Checkout flow (Stripe):** Correctly maps `card` to `stripe` provider, sends `checkout_session_id` to `select-payment-provider`, receives `clientSecret`, navigates to `/card-payment`
- **Checkout flow (PawaPay):** Correctly maps `mobile_money` to `pawapay`, sends phone + operator, navigates to `/payment-pending`
- **Duplicate payment prevention:** `select-payment-provider` checks `payment_attempts` for existing `pending/processing/paid` attempts and returns idempotent responses with `ALREADY_PAID` code
- **Cart sync:** Uses `sessionRef` to prevent ghost re-additions, `deletedItemIdsRef` with TTL to prevent deleted items from reappearing, dedup using `canonicalItemKey`
- **Cart clearing:** Only happens on confirmed `PAID` status via `clearCartOnPaymentSuccess()`
- **Payment callback page:** Polls `mobile-verify-payment` correctly for both PawaPay and Stripe
- **PaymentPending page:** Polls order status for PawaPay USSD confirmation
- **PawaPay webhook (`payments-webhook`):** Not affected by changes
- **Order detail retry:** Uses `order.status === 'PENDING_PAYMENT'` (no MaishaPay dependency)

## Implementation Order

1. Fix `verify-payment/index.ts` -- replace `maishapayStatus` with `normalizedStatus` (line 333)
2. Fix `CardPayment.tsx` -- change `/shop/payment-success` to `/payment-success-shop` (lines 121 and 133)
3. Update `src/lib/i18n/translations.ts` -- clean up MaishaPay and bank transfer text
4. Update `src/lib/environment.ts` -- remove legacy paths from `excludedPaths`
5. Redeploy `verify-payment` edge function
