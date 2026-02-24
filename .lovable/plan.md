
# Payment Redirect Fix: PawaPay and Stripe

## Issues Found

### 1. FRONTEND_URL Secret Mismatch (Medium Risk)
The `select-payment-provider` function reads `FRONTEND_URL` (lines 229, 471) but the configured secret is named `FRONTEND_BASE_URL`. This means the fallback `https://afri-shop.com` (wrong domain) is always used for the `redirectUrl` field. While the web app ignores this (it navigates client-side), the mobile app may rely on it.

**Fix:** Change the code to read `FRONTEND_BASE_URL` instead of `FRONTEND_URL`, and update the fallback to `https://afrishop-usa.com`.

### 2. Legacy BANK_TRANSFER Still in mobile-checkout (Code Smell)
`mobile-checkout/index.ts` (2,344 lines) still has `BANK_TRANSFER` in its type definitions and routing logic (lines 26-33). This was missed in the previous cleanup.

**Fix:** Remove `BANK_TRANSFER` from `PaymentFlow`, `PaymentMethodPreference`, and `VALID_PAYMENT_PREFERENCES` types. Remove any bank transfer routing paths.

### 3. Legacy MaishaPay in vehiclePaymentGuard.ts
`_shared/vehiclePaymentGuard.ts` still references MaishaPay currency logic and `VEHICLE_BANK_TRANSFER_REQUIRED` error in `paymentProviders.ts` line 217.

**Fix:** Clean these references. Vehicle orders should use Stripe only; if Stripe is unavailable, return a clear "card payment unavailable" error instead of `VEHICLE_BANK_TRANSFER_REQUIRED`.

### 4. Stale MaishaPay Secrets (10 secrets)
There are 10+ `MAISHAPAY_*` and `MAISHA_*` secrets still configured. These are dead weight and could cause confusion.

**Fix:** These cannot be cleaned by code changes, but noted for manual cleanup.

## Implementation Plan

### Step 1: Fix FRONTEND_URL in select-payment-provider
Update two lines in `supabase/functions/select-payment-provider/index.ts`:
- Line 229: `Deno.env.get('FRONTEND_URL')` to `Deno.env.get('FRONTEND_BASE_URL')`
- Line 471: Same change
- Update fallback from `https://afri-shop.com` to `https://afrishop-usa.com`

### Step 2: Clean mobile-checkout types
In `supabase/functions/mobile-checkout/index.ts`:
- Remove `BANK_TRANSFER` from `PaymentFlow` type
- Remove `BANK_TRANSFER` from `PaymentMethodPreference` type and `VALID_PAYMENT_PREFERENCES`
- Remove `bank_transfer_enabled` references in `PaymentSettings`

### Step 3: Clean vehiclePaymentGuard.ts
- Remove MaishaPay currency logic
- Change `VEHICLE_BANK_TRANSFER_REQUIRED` to `VEHICLE_CARD_REQUIRED`

### Step 4: Clean paymentProviders.ts
- Replace bank transfer fallback message with card-only error

### Step 5: Redeploy affected edge functions
- `select-payment-provider`
- `mobile-checkout`

## Technical Notes

The actual web redirect flow (Checkout.tsx to /payment-pending or /card-payment) is structurally correct. The frontend navigates client-side based on the response from `select-payment-provider`:
- PawaPay: `providerData.status === 'pending_user_confirmation'` navigates to `/payment-pending`
- Stripe: `providerData.clientSecret` exists navigates to `/card-payment`

The `redirectUrl` from the backend is only used by external/mobile deep links, not the web app. So if web redirects are "not working," it may also be a Stripe publishable key or PawaPay config issue. We should test the full flow after these fixes.
