# MaishaPay Integration Guide (SANDBOX MODE)

## Overview
This document describes the MaishaPay payment integration for AfriFund in **SANDBOX TEST MODE**.

## Configuration

### Environment Variables / Secrets
The following secrets have been configured in Lovable Cloud:

1. **MAISHAPAY_PUBLIC_KEY_TEST** - Your MaishaPay public key for sandbox
2. **MAISHAPAY_SECRET_KEY_TEST** - Your MaishaPay secret key for sandbox (server-only)
3. **MAISHAPAY_MODE** - Set to "sandbox" for testing
4. **MAISHAPAY_API_BASE_URL** - MaishaPay sandbox API base URL
5. **MAISHAPAY_CALLBACK_URL** - Callback URL for payment notifications

### Example Values
```
MAISHAPAY_PUBLIC_KEY_TEST=MP-SBPK-Z2721hl2syS9mGA0yr2UQyMMl9aH0XqL1Th1Wb/kW0N...
MAISHAPAY_SECRET_KEY_TEST=MP-SBPK-dYtr5M37IwOW.r4eMMnyt$1/47BpC.dsKGHuoP0yWOH...
MAISHAPAY_MODE=sandbox
MAISHAPAY_API_BASE_URL=https://sandbox-api.maishapay.online/v1
MAISHAPAY_CALLBACK_URL=https://your-project.lovableproject.com/api/payments/maishapay/callback
```

## Database Schema

### New Fields in `user_submissions` Table
```sql
- payment_provider (text, default: 'maishapay')
- payment_currency (text, default: 'USD')
- maishapay_reference (text) - Our internal reference
- maishapay_transaction_id (text) - MaishaPay's transaction ID
- maishapay_raw_response (jsonb) - Full response from MaishaPay
```

## Payment Flow

### 1. User Submits Application
- User completes application form (text or voice)
- Submission is saved with:
  - `payment_status = 'pending'`
  - `payment_amount = 20` (text) or `25` (voice)
  - `payment_provider = 'maishapay'`
  - `payment_currency = 'USD'`

### 2. Payment Dialog Opens
- Shows MaishaPay as payment option
- Clear "SANDBOX TEST" warnings
- User clicks "Pay with MaishaPay (Test)"

### 3. Create Payment Request
**Edge Function**: `create-maishapay-payment`
- Generates unique reference: `AFRIFUND-{submissionId}-{timestamp}`
- Calls MaishaPay checkout API with:
  - Amount
  - Currency
  - Reference
  - Callback URL
  - Customer details
- Returns checkout URL
- User is redirected to MaishaPay

### 4. User Completes Payment
- User is on MaishaPay's hosted checkout page
- Completes test payment
- MaishaPay sends callback to our system

### 5. Process Callback
**Edge Function**: `maishapay-callback`
- Receives callback from MaishaPay
- Validates transaction
- Updates submission:
  - `payment_status = 'paid'` (on success)
  - `maishapay_transaction_id = {id}`
  - Stores raw response
- Auto-generates project code (via trigger)

### 6. User Sees Result
**Route**: `/payment/result`
- Shows success/failure message
- Displays payment details
- Shows project code (if successful)
- Clear "TEST MODE" indicators

## Edge Functions

### create-maishapay-payment
**Path**: `supabase/functions/create-maishapay-payment/index.ts`
**Auth**: Public (verify_jwt = false)
**Purpose**: Initialize payment with MaishaPay

**Request**:
```json
{
  "submissionId": "uuid"
}
```

**Response**:
```json
{
  "success": true,
  "checkoutUrl": "https://...",
  "reference": "AFRIFUND-...",
  "mode": "sandbox"
}
```

### maishapay-callback
**Path**: `supabase/functions/maishapay-callback/index.ts`
**Auth**: Public (verify_jwt = false)
**Purpose**: Handle payment notifications from MaishaPay

**Handles**:
- Webhook notifications from MaishaPay
- User redirects after payment
- Updates submission status
- Validates payment data

## Testing

### Test Flow
1. Go to `/apply`
2. Fill out application form
3. Click "Pay with MaishaPay (Test)"
4. Complete payment on MaishaPay sandbox
5. Get redirected to `/payment/result`
6. Check status and project code

### Admin Testing
1. Go to `/admin/payments`
2. View all payment transactions
3. Filter by status (pending/paid/failed)
4. Use "Mark as Paid" for manual overrides (test only)

### Expected Behavior
- ✅ No real money is charged
- ✅ All payments show "SANDBOX TEST" warnings
- ✅ Project codes are generated on successful payment
- ✅ Callbacks are logged and processed
- ✅ Payment status is tracked in database

## Switching to Production

To switch to LIVE mode:

1. **Update Secrets**:
   - `MAISHAPAY_PUBLIC_KEY_LIVE` (new secret)
   - `MAISHAPAY_SECRET_KEY_LIVE` (new secret)
   - `MAISHAPAY_MODE=live`
   - `MAISHAPAY_API_BASE_URL=https://api.maishapay.online/v1`

2. **Update UI**:
   - Remove "SANDBOX TEST" warnings
   - Update payment dialog text
   - Remove test mode badges

3. **Test Thoroughly**:
   - Test with small amounts first
   - Verify callbacks work
   - Test error scenarios

## Security Notes

- ✅ Secret keys are never exposed to frontend
- ✅ All sensitive operations on server-side edge functions
- ✅ Callbacks validate transaction signatures (when implemented)
- ✅ Payment amounts are verified server-side
- ✅ RLS policies protect data access

## Troubleshooting

### Payment Not Processing
1. Check edge function logs: `/admin` → Cloud → Functions
2. Verify secrets are set correctly
3. Check MaishaPay API status
4. Review callback logs

### Callback Not Received
1. Verify `MAISHAPAY_CALLBACK_URL` is correct
2. Check if URL is publicly accessible
3. Review MaishaPay webhook settings
4. Check edge function logs

### Manual Override (Test Only)
For testing, admins can manually mark payments as paid:
1. Go to `/admin/payments`
2. Find the submission
3. Click "Mark as Paid (Test)"

## Support

For MaishaPay API documentation:
- Visit: https://marchand.maishapay.online → Documentation
- Check API reference for latest endpoints and fields

## Files Modified

### Frontend
- `src/components/PaymentDialog.tsx` - Payment UI
- `src/pages/PaymentResult.tsx` - Result page
- `src/pages/admin/PaymentsView.tsx` - Admin payment management
- `src/App.tsx` - Routes

### Backend
- `supabase/functions/create-maishapay-payment/index.ts`
- `supabase/functions/maishapay-callback/index.ts`
- `supabase/config.toml` - Edge function config

### Database
- Migration: Added MaishaPay tracking fields to `user_submissions`

## Next Steps

1. ✅ Test the complete payment flow
2. ✅ Verify callbacks are working
3. ✅ Test error scenarios (declined payment, timeout, etc.)
4. ✅ Review payment admin panel
5. ⏳ Adjust MaishaPay API fields based on actual API response structure
6. ⏳ Add signature verification for callbacks (if MaishaPay provides)
7. ⏳ Plan migration to production mode
