

## Diagnosis: The Issue is in the RN App, Not the Backend

### Evidence

1. **Backend logs confirm zero checkout calls** — `mobile-checkout` and `mobile-orders` have no logs at all when "Payez maintenant" is tapped
2. **Auth works fine** — `auth-me` returns 200 with the correct user after reinstall
3. **Backend is already fully hardened** — all checkout/payment functions return HTTP 200 with structured JSON errors (never raw 401/403), accept tokens from all headers, and have `verify_jwt = false` in config.toml

### What's Actually Happening

The RN app's "Payez maintenant" button handler **checks auth client-side before making any API call**. After reinstall, that client-side check fails and redirects to Login. The backend never gets the request.

Replit correctly identified the fix location: `client.ts`, `cart.ts`, and `CartScreen.tsx` — **these are RN app files, not in this Lovable project**.

### What Replit Found (the actual fix needed)

The RN app's `client.ts` has an `onSessionExpired()` callback that calls `logout()` and navigates to Login. When the checkout handler runs, either:
- A pre-flight auth validation fails and triggers `onSessionExpired()`
- The Supabase token is stale and the client detects it before making the call

The fix requires changes to **3 RN app files**:

1. **`client.ts`** — Add a `suppressSessionExpired` flag so checkout requests don't trigger auto-logout
2. **`cart.ts`** — Call `apiPostWithOptions` with `{ suppressSessionExpired: true }` and proactively refresh the token before checkout
3. **`CartScreen.tsx`** — Call `refreshSession()` before checkout and handle auth errors gracefully in the catch block instead of redirecting

### What Cannot Be Fixed From This Project

Since the RN app code is not in this repository and the Replit Agent is disabled, these RN-side changes cannot be made here. The backend side is complete — every function in the checkout chain already:
- Accepts tokens from 7+ header sources
- Returns HTTP 200 with `{ ok: false, authenticated: false, error_code: "..." }` instead of raw 401/403
- Has `verify_jwt = false` in config.toml
- Forwards all auth headers downstream

### Options to Move Forward

1. **Re-enable Replit Agent** and apply the 3-file fix Replit already identified
2. **Manually edit** `client.ts`, `cart.ts`, and `CartScreen.tsx` in the RN project using the exact code patterns Replit provided
3. **Publish an OTA update** via `expo publish` after applying the fix — no app store review needed if using Expo Updates

The backend work from this project is done. The remaining fix is purely in the RN app's client-side authentication handling.

