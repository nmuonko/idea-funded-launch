

## Plan: Payment Flow Audit and Fixes

### Issues Found

**1. Broken redirect in CardPayment (line 144)**
`navigate('/shop/orders/${orderId}')` — No route exists for `/shop/orders/:id`. Only `/shop/orders` (without ID) has a redirect to `/my-orders`. This causes a 404 when Stripe returns an unexpected payment status (e.g. `requires_capture`).

**Fix:** Change to `navigate('/orders/${orderId}')` which matches the existing route.

**2. Missing CORS headers on `payments-provider` and `payments-core`**
Both functions use incomplete CORS headers missing `x-supabase-client-platform`, `x-supabase-client-platform-version`, `x-supabase-client-runtime`, `x-supabase-client-runtime-version`. The Supabase JS client sends these headers by default, and missing them in `Access-Control-Allow-Headers` can cause preflight failures on certain browsers/mobile WebViews.

**Fix:** Update both functions to include the full required CORS header set.

**3. `PaymentResult.tsx` links to `/shop/orders` instead of `/my-orders`**
The "View Order" button on the payment result component links to `/shop/orders` which redirects to `/my-orders` — this works via redirect but adds an unnecessary hop.

**Fix:** Change to `/my-orders` directly.

**4. `PaymentPending` retry calls `payments-core` with `action: 'retry'`**
This forwards to `mobile-retry-payment`. Need to verify this function exists.

### No Issues Found (Confirmed Working)

- **Idempotency:** `select-payment-provider` checks `payment_attempts` for existing active statuses before creating new ones
- **Stripe flow:** `CardPayment` → `confirmPayment` → redirects to `/payment-success-shop` on success — correct
- **PawaPay flow:** `Checkout` → `payments-provider/select` → `/payment-pending` → polls order status → shows success/fail — correct
- **PaymentCallback:** Polls `payments-core/verify`, redirects to `/payment-success-shop` on `paid` — correct
- **PaymentSuccess (shop):** Clears cart, polls for `PAID` status, handles missing sessions for WebViews — correct
- **Route configuration:** `/payment-pending`, `/payment-success-shop` are outside `ShopProtectedRoute` — correct for mobile WebView stability
- **DRAFT timeout:** 60-second grace period in PaymentPending — correct

### Files to Edit

| File | Change |
|---|---|
| `src/pages/shop/CardPayment.tsx` | Fix broken `/shop/orders/` redirect → `/orders/` |
| `supabase/functions/payments-provider/index.ts` | Fix CORS headers |
| `supabase/functions/payments-core/index.ts` | Fix CORS headers |
| `src/components/shop/PaymentResult.tsx` | Fix `/shop/orders` → `/my-orders` |

All changes are small, targeted fixes. No architectural changes needed — the payment flow is well-structured.

