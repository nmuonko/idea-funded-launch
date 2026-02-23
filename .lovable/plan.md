

# Remove MaishaPay and Bank Transfer -- Implementation Plan

## Overview
Remove all MaishaPay and Bank Transfer code, keeping only Stripe and PawaPay as active payment providers.

## Phase 1: Delete Frontend Pages (8 files)

Delete these files entirely:
- `src/pages/MaishapayResult.tsx`
- `src/pages/MaishapayCheckout.tsx`
- `src/pages/MaishaCallback.tsx`
- `src/pages/BankTransfer.tsx`
- `src/pages/BankTransferInfo.tsx`
- `src/pages/PublicBankTransfer.tsx`
- `src/pages/ManualTransfer.tsx`
- `src/pages/admin/BankTransferSettings.tsx`

## Phase 2: Clean Up App.tsx

- Remove imports for: `PublicBankTransfer`, `BankTransfer`, `ManualTransfer`, `MaishaCallback`, `MaishapayCheckout`, `MaishapayResult`, `BankTransferInfo`
- Remove routes: `/maisha-callback`, `/maishapay/checkout`, `/maishapay/result`, `/bank-transfer`, `/bank-transfer-legacy`, `/bank-transfer-info`, `/manual-transfer/:uploadToken`
- Remove `/bank-transfer`, `/manual-transfer`, `/maishapay` from the `publicPaths` splash screen check

## Phase 3: Clean Up Checkout.tsx

- Remove `'bank_transfer': 'bank_transfer'` from `providerMap` (line 235)
- Remove `bank_transfer` handling in checkout payload (lines 206-208)
- Remove `bank_transfer` provider response handling (lines 302-310, 325-327)

## Phase 4: Clean Up Customer OrderDetail.tsx

- Change query from `'*, order_items(*), maisha_payments(*)'` to `'*, order_items(*)'` (line 43)
- Remove `const payment = order.maisha_payments?.[0];` (line 204)
- Remove payment info card that references `payment` (lines 285-319)
- Change retry condition from `order.status === 'PENDING_PAYMENT' || order.maisha_payment_status === 'failed'` to just `order.status === 'PENDING_PAYMENT'` (line 419)
- Remove the track order button that uses `payment?.confirmation_code` (lines 437-445)

## Phase 5: Clean Up Admin Pages

### admin/Payments.tsx
- Rewrite to query `payment_attempts` table instead of `maisha_payments`
- Remove `verify-maisha-payment` function invocation
- Update interface and display fields

### admin/Orders.tsx
- Remove `maisha_payment_status` from CSV export (line 344)
- Remove `maisha_payment_status === 'SUCCESS'` check in bulk receipt download (line 388)

### admin/SupportContactSettings.tsx
- Change from reading/writing `bank_transfer_settings` table to `settings` table (support_whatsapp, support_email columns)

## Phase 6: Clean Up Edge Functions (shared utilities)

### `_shared/circuitBreaker.ts`
- Remove `'maishapay'` entry from `SERVICE_CONFIGS` (lines 53-57)

### `_shared/checkoutResponse.ts`
- Remove `BankTransferDetails` interface
- Remove `bank_transfer` field from `CheckoutResponse`
- Remove `BankConfig` interface and `getBankConfig()` function
- Remove `getBankDetailsFromSettings()` function
- Remove `buildManualResponse()` function
- Keep `buildRedirectResponse`, `buildCheckoutErrorResponse`, `buildServerErrorResponse`, rate limiting, and logging helpers

### `_shared/paymentProviders.ts`
- Clean: already references only PawaPay and Stripe -- minimal changes needed (comment cleanup on line 179)

## Phase 7: Clean Up select-payment-provider Edge Function

- Remove `'bank_transfer'` from `ProviderSelection` type and `VALID_PROVIDERS` array (lines 36-37)
- Remove entire BANK_TRANSFER handler block (lines 693-770)
- Remove `maisha_payment_status: 'PENDING'` update in PawaPay success (line 464)
- Update error message to show only "pawapay, stripe" (line 82-83)

## Phase 8: Clean Up verify-payment Edge Function

- Remove `MAISHAPAY_WEBHOOK_SECRET` check (line 176)
- Remove `maisha_payment_status`, `maisha_status_code`, `maisha_description` updates on orders (lines 332-337)
- Remove `maisha_payments` table updates (lines 339-344)
- Keep core finalize_paid_order RPC logic

## Phase 9: Clean Up Static Pages

- `src/pages/About.tsx` line 22: Change "mobile money and bank transfers" to "mobile money and card payments"
- `src/pages/Terms.tsx` line 179: Change "mobile money, bank transfers, and other payment methods" to "mobile money, card payments, and other payment methods"

## Phase 10: Delete Edge Functions (11 functions)

Delete these function directories:
- `supabase/functions/verify-maisha-payment/`
- `supabase/functions/web-maisha-callback/`
- `supabase/functions/get-bank-transfer-settings/`
- `supabase/functions/get-bank-transfer-view/`
- `supabase/functions/get-manual-transfer-page/`
- `supabase/functions/create-bank-transfer-view-link/`
- `supabase/functions/create-manual-transfer-session/`
- `supabase/functions/submit-bank-transfer-proof/`
- `supabase/functions/upload-manual-transfer-proof/`
- `supabase/functions/notify-large-bank-transfer/`
- `supabase/functions/create-payment-link/`

Remove their entries from `supabase/config.toml` and delete deployed functions from Supabase.

## What is NOT Changed

- Database tables (`maisha_payments`, `bank_transfer_settings`, etc.) stay for historical data
- `orders` table columns (`maisha_payment_status`, etc.) stay but are no longer written to
- `finalize_paid_order` RPC stays (used by PawaPay and Stripe)

