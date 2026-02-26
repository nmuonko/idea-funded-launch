

## Make Payment Success Page Work Without Web Auth (Mobile WebView Compatibility)

### Problem
The mobile app's payment flow opens a WebView that eventually redirects to the web app. The flow is:

1. Mobile WebView opens PawaPay/Stripe payment page
2. After payment, redirects to `/payment-callback` (already public -- works fine)
3. `/payment-callback` polls `mobile-verify-payment`, then redirects to `/payment-success-shop`
4. `/payment-success-shop` is wrapped in `ShopProtectedRoute` which requires a web auth session
5. The mobile WebView does NOT have a web auth session, so it gets redirected to `/shop-auth` -- **payment confirmation fails**

### Solution
Remove the `ShopProtectedRoute` wrapper from `/payment-success-shop` in `App.tsx`. This is safe because:

- The page only reads the `order_id` from query params and checks order status via `supabase.from('orders')`, which is protected by RLS policies
- The page doesn't expose any sensitive data beyond a truncated order ID (`order_id.slice(0,8)`)
- Cart clearing (`clearCartOnPaymentSuccess`) is a client-side operation that gracefully no-ops if there's no cart
- The page is a dead-end (shows success message with links to orders/home) -- no further sensitive actions

### Changes

**File: `src/App.tsx`** (1 change)

Remove `ShopProtectedRoute` from the `/payment-success-shop` route:

```text
Before:
  <Route path="/payment-success-shop" element={
    <ShopProtectedRoute>
      <ShopPaymentSuccess />
    </ShopProtectedRoute>
  } />

After:
  <Route path="/payment-success-shop" element={<ShopPaymentSuccess />} />
```

This is a minimal, surgical change. No new pages, no new endpoints. The existing mobile `.aab` builds will work without modification since the redirect URLs are already correct -- they were just being blocked by the auth guard.

