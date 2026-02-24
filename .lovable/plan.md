

# Payment Legacy Cleanup: Remove MaishaPay and Bank Transfer

## Problem
MaishaPay and Bank Transfer were removed as active payment methods, but their code remains across ~40+ files in both frontend and backend. This creates confusion, dead code paths, and a potential bug where `OrderDetailsDrawer` calls a non-existent `verify-maisha-payment` edge function.

## Scope

### Phase 1: Fix Critical Bug
- **`src/components/admin/OrderDetailsDrawer.tsx`** — Replace `verify-maisha-payment` call with the correct `verify-payment` function (the one that actually exists and handles PawaPay/Stripe)

### Phase 2: Frontend Cleanup
Remove or update these files:

| File | Action |
|------|--------|
| `PendingBankTransfersWidget.tsx` | Delete entirely |
| `PaymentVerificationPanel.tsx` | Remove "bank transfer" wording |
| `Onboarding.tsx` | Remove "Bank Transfer" from payment method list |
| `HowItWorks.tsx` | Remove "bank transfer" from description |
| `translations.ts` | Rename `bankTransferSettings` to `paymentsSettings`, rename `maishaPayRef` to `paymentRef` |
| Any dashboard importing `PendingBankTransfersWidget` | Remove the import and usage |

### Phase 3: Edge Function Cleanup
Update these edge functions to stop referencing legacy fields while keeping backward compatibility with existing database columns:

| Function | Change |
|----------|--------|
| `payments-webhook` | Remove `maishapay` case entirely |
| `payment-health` | Remove bank transfer checks, remove MaishaPay checks |
| `health` | Remove `MAISHAPAY_*` from optional vars |
| `mobile-order-status` | Stop returning `maishapay_transaction_id` |
| `mobile-retry-payment` | Remove "fall back to MaishaPay" logic |
| `payment-status` | Remove `maisha_payments` lookup path |
| `generate-payment-receipt` | Use `payment_attempts` instead of `maisha_transaction_id` |
| `send-payment-confirmation` | Use `payment_attempts` instead of `maisha_payments` |
| `admin-order-action` | Remove `maisha_payment_status` write |
| `mobile-create-payment` | Remove MaishaPay routing comment, clean status writes |
| `pawapay-create-payment` | Remove `maisha_transaction_id`/`maisha_payment_status` writes (use `payment_attempts` only) |
| `mobile-verify-payment` | Remove `maisha_transaction_id` lookup fallback |

### Phase 4: Database Columns (No Action Now)
The following database columns are legacy but **should NOT be deleted yet** — they contain historical data:
- `orders.maisha_payment_status`
- `orders.maisha_transaction_id`
- `maisha_payments` table
- `bank_transfer_settings` table
- `bank_transfer_submissions` table
- `bank_transfer_view_tokens` table

These can be archived/dropped in a future migration once you confirm no reports or analytics depend on them.

## Technical Details

### Critical Bug Fix
```typescript
// OrderDetailsDrawer.tsx currently calls:
supabase.functions.invoke('verify-maisha-payment', { body: { orderId } })
// This function DOES NOT EXIST — will always fail silently

// Should call:
supabase.functions.invoke('verify-payment', { body: { order_id: orderId } })
```

### Edge Function Changes
- All functions that write `maisha_payment_status` on new orders will stop doing so
- Functions will read it only for backward compatibility (existing orders)
- `payment_attempts` table becomes the single source of truth for all payment status

### Deployment
- ~15 edge functions need redeployment
- Frontend changes are immediate on save
- No database migrations needed (columns preserved)

## Risk Assessment
- **Low risk**: All active payment flows already use `payment_attempts` table via PawaPay/Stripe
- **No user impact**: MaishaPay and bank transfer are not selectable by users
- **Backward compatible**: Old orders with `maisha_payment_status = 'SUCCESS'` still display correctly since we only remove *writes*, not *reads* (for now)

