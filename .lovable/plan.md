

# Remove MaishaPay and Bank Transfer -- Keep Only Stripe and PawaPay

## Overview

MaishaPay and Bank Transfer are legacy payment providers that are no longer in use. This plan removes all related frontend pages, edge functions, routing, and shared utility references, while ensuring Stripe and PawaPay continue to work correctly.

## Scope of Changes

### 1. Frontend Pages to DELETE (6 files)

| File | Purpose |
|---|---|
| `src/pages/MaishapayResult.tsx` | MaishaPay payment callback page |
| `src/pages/MaishapayCheckout.tsx` | MaishaPay checkout redirect page |
| `src/pages/MaishaCallback.tsx` | MaishaPay callback handler |
| `src/pages/BankTransfer.tsx` | Bank transfer details page (legacy) |
| `src/pages/BankTransferInfo.tsx` | Bank transfer info after checkout |
| `src/pages/PublicBankTransfer.tsx` | Public bank transfer page |
| `src/pages/ManualTransfer.tsx` | Manual transfer upload page |
| `src/pages/admin/BankTransferSettings.tsx` | Admin bank transfer config |

### 2. Edge Functions to DELETE (12 functions)

| Function | Purpose |
|---|---|
| `verify-maisha-payment` | Verify MaishaPay payment status |
| `web-maisha-callback` | MaishaPay webhook handler |
| `get-bank-transfer-settings` | Fetch bank transfer config |
| `get-bank-transfer-view` | Generate bank transfer view |
| `get-manual-transfer-page` | Manual transfer page data |
| `create-bank-transfer-view-link` | Generate bank transfer view links |
| `create-manual-transfer-session` | Create manual transfer upload session |
| `submit-bank-transfer-proof` | Submit bank transfer proof of payment |
| `upload-manual-transfer-proof` | Upload manual transfer proof |
| `notify-large-bank-transfer` | Notify admin of large bank transfers |
| `create-payment-link` | Legacy MaishaPay payment link creator |
| `maishapay-process-result` | (Does not exist yet -- was planned, no longer needed) |

### 3. App.tsx Route Cleanup

Remove all routes and imports for:
- `/maisha-callback`
- `/maishapay/checkout`
- `/maishapay/result`
- `/bank-transfer`
- `/bank-transfer-legacy`
- `/bank-transfer-info`
- `/manual-transfer/:uploadToken`

Remove these paths from the `publicPaths` check that includes `/bank-transfer`, `/manual-transfer`, `/maishapay`.

### 4. Checkout.tsx Cleanup

- Remove the `bank_transfer` option from `providerMap` (line 235)
- Remove `bank_transfer` handling in checkout response (lines 302-310, 325-327)
- Remove `paymentMethod === 'bank_transfer'` condition (line 206-208)
- The payment method radio group already only shows Mobile Money and Card (bank transfer radio was already removed) -- verified, no changes needed in UI

### 5. Edge Function Cleanup (shared utilities)

- `_shared/paymentProviders.ts`: Remove bank_transfer fallback references and MaishaPay comments
- `_shared/circuitBreaker.ts`: Remove `maishapay` entry from circuit breaker config
- `_shared/checkoutResponse.ts`: Remove `bank_transfer` field from response types and bank transfer helper functions
- `_shared/vehiclePaymentGuard.ts`: Remove MaishaPay currency logic comments (vehicles now use Stripe only)

### 6. select-payment-provider Edge Function

- Remove `bank_transfer` from `VALID_PROVIDERS` array and `ProviderSelection` type
- Remove the entire `BANK_TRANSFER` handler block (~80 lines)
- Remove `maisha_payment_status` updates from PawaPay/Stripe flows
- Update error messages to show only "pawapay, stripe"

### 7. verify-payment Edge Function

- Remove `MAISHAPAY_WEBHOOK_SECRET` check
- Remove `maisha_payments` table updates
- Remove `maisha_payment_status`, `maisha_status_code`, `maisha_description` field updates on orders
- Keep the core order finalization logic (used by PawaPay and Stripe)

### 8. Admin Pages Cleanup

- `src/pages/admin/Payments.tsx`: This page queries `maisha_payments` table. Rewrite to query `payment_attempts` table instead (which tracks all providers including PawaPay and Stripe)
- `src/pages/admin/Orders.tsx`: Remove `maisha_payment_status` references from CSV export and paid status checks
- `src/pages/admin/OrderDetail.tsx`: Remove `maisha_transaction_id` display, remove `maisha_payment_status` check
- `src/pages/admin/SupportContactSettings.tsx`: Stop reading/writing from `bank_transfer_settings` table; use a different settings source or simplify

### 9. OrderDetail.tsx (Customer)

- Remove `maisha_payments(*)` from the order query
- Remove `order.maisha_payments?.[0]` reference
- Remove `order.maisha_payment_status === 'failed'` retry condition (use `order.status === 'PENDING_PAYMENT'` only)

### 10. Other Files

- `src/pages/About.tsx`: Update "bank transfers" text to just say "mobile money and card payments"
- `src/pages/Terms.tsx`: Update "bank transfers" mention to "mobile money and card payments"
- `src/lib/i18n/translations.ts`: No changes needed (generic payment method labels are fine)
- `supabase/config.toml`: Remove entries for all deleted edge functions

## What is NOT Changed

- **Database tables** (`maisha_payments`, `bank_transfer_settings`, etc.): These tables stay in the database. Removing tables requires careful migration and could affect historical order data. The tables will simply no longer be written to.
- **`finalize_paid_order` RPC**: Still used by PawaPay and Stripe flows
- **`orders` table columns** (`maisha_payment_status`, `maisha_transaction_id`, etc.): Left in place for historical data; just no longer written to by new code

## Execution Order

1. Delete frontend pages (MaishaPay + Bank Transfer)
2. Clean up App.tsx routes and imports
3. Clean up Checkout.tsx payment flow
4. Clean up admin pages
5. Clean up customer OrderDetail
6. Clean up edge functions (shared utilities first, then specific functions)
7. Delete edge functions from filesystem and Supabase
8. Update config.toml
9. Verify Stripe and PawaPay flows still work

