
## Fix: Payment Success Page Not Showing After Stripe Payment

### Root Cause

The Stripe checkout session is configured with the **wrong redirect URL**. After a successful Stripe payment, the user is redirected to the wrong page.

In `supabase/functions/stripe-create-checkout-session/index.ts` (line 176):
```
success_url = https://afrishop-usa.com/payment-success?orderId=...
```

This sends users to `/payment-success` -- an **old legacy page** that:
- Does NOT clear the shopping cart
- Calls a different verification function (`payment-status` instead of checking order status directly)
- Shows a "Close Window" button instead of proper shop navigation
- Has no shop header or branding
- Uses `orderId` param but the shop success page expects `order_id`

The **correct** shop success page is at `/payment-success-shop`, which shows the animated success UI, clears the cart, and lets users view their order or continue shopping.

### Additionally

The `PaymentCallback` page (used for the legacy Stripe flow) also doesn't redirect to `/payment-success-shop` after confirming payment -- it just shows its own basic success UI with no cart clearing.

### Plan

#### 1. Fix Stripe checkout session redirect URL (`stripe-create-checkout-session/index.ts`)

Change line 176 from:
```
/payment-success?orderId=${order_id}&session_id={CHECKOUT_SESSION_ID}
```
to:
```
/payment-success-shop?order_id=${order_id}&provider=stripe
```

Also update the cancel URL to go back to `/checkout` instead of `/payment-fail`.

#### 2. Fix PaymentCallback to redirect on success (`src/pages/PaymentCallback.tsx`)

When the payment status resolves to "succeeded", redirect the user to `/payment-success-shop?order_id=...` instead of just showing an inline success card. This ensures the cart gets cleared and the user sees the proper success experience.

### Files Changed

| File | Change |
|------|--------|
| `supabase/functions/stripe-create-checkout-session/index.ts` | Fix `success_url` to `/payment-success-shop?order_id=...&provider=stripe` |
| `src/pages/PaymentCallback.tsx` | On payment success, redirect to `/payment-success-shop` instead of showing inline UI |
