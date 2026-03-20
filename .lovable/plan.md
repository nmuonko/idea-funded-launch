

## Diagnosis

**Root cause identified**: After reinstall, the RN app successfully authenticates for API calls (auth-me, mobile-profile, mobile-cart all return 200). However, **no backend checkout call is ever made** — there are zero logs for `mobile-orders`, `mobile-checkout`, or any checkout-related endpoint when "Payez maintenant" is tapped.

This confirms the redirect to login happens **entirely client-side** before any backend call. The most likely mechanism: the frozen RN app opens a WebView to the web frontend's `/checkout` route. After reinstall, the WebView's localStorage (where Supabase stores sessions) is wiped, so `ShopProtectedRoute` sees `session === null` and redirects to `/shop-auth`.

**Evidence**:
- Auth logs show successful login and /user calls with status 200
- Edge function logs show mobile-get-cart, mobile-profile, auth-me all working
- Zero calls to mobile-orders or mobile-checkout after "Payez maintenant" tap
- `ShopProtectedRoute` on line 37 redirects when `!session`

## Plan — WebView Session Bootstrap

Since the RN app is frozen, we fix the web frontend to accept auth tokens from the WebView URL and bootstrap a Supabase session before the route guard fires.

### 1. Create a `useTokenFromUrl` hook

New file: `src/hooks/useTokenFromUrl.ts`

- On mount, check URL for `?token=` or `?access_token=` parameter (common patterns RN apps use when opening WebViews)
- If found, call `supabase.auth.setSession()` with the token to establish a session in the WebView's storage
- Remove the token from the URL after consuming it (security)

### 2. Update `ShopProtectedRoute` to wait for URL token bootstrap

- Before redirecting to login when `!session`, check if a URL token is present
- If so, show a loading spinner while the token bootstrap completes
- Only redirect after confirming no valid token is available

### 3. Update `AuthContext` initialization to handle WebView token injection

- During `initializeAuth`, check URL params for `token` / `access_token` / `refresh_token`
- If found, call `supabase.auth.setSession({ access_token, refresh_token })` before `getSession()`
- This ensures the session is available immediately for route guards

### 4. Add a `/checkout-bridge` endpoint (backend)

New edge function: `mobile-checkout-bridge`

- The RN app can call this endpoint to get a pre-authenticated checkout URL
- Returns: `{ url: "https://idea-funded-launch.lovable.app/checkout?token=<jwt>&refresh_token=<rt>" }`
- This gives the frozen RN app a URL it can open in the WebView with valid credentials
- Even though the RN app is frozen, if it already constructs WebView URLs with token params, this will work immediately

### 5. Fallback: Make Checkout handle unauthenticated state gracefully

- Inside `Checkout.tsx`, if `!session` after auth is ready, show an inline "Sign in to continue" form instead of relying on the route-level redirect
- This prevents the hard redirect that the RN app can't recover from

### Files to create/modify:
- **Create**: `src/hooks/useTokenFromUrl.ts`
- **Modify**: `src/contexts/AuthContext.tsx` (add URL token bootstrap in initializeAuth)
- **Modify**: `src/components/shop/ShopProtectedRoute.tsx` (wait for token bootstrap)
- **Create**: `supabase/functions/mobile-checkout-bridge/index.ts` (optional, for future RN updates)
- Deploy: `mobile-checkout-bridge`

