
Problem I’m fixing: on mobile, users with a valid persisted session are still being treated as logged out when they tap the cart checkout button.

Do I know what the issue is? Yes.

What the code is doing now:
- `AuthContext` registers `onAuthStateChange` before auth hydration is fully settled.
- The callback can set `loading=false` and `session/user=null` too early.
- `ShopProtectedRoute` redirects as soon as `loading` is false and `session/user` are empty.
- The backend auth logs show repeated successful `/user` calls (HTTP 200), so many affected users do have a real session; the redirect is happening in frontend timing/state, not because the backend rejected them.
- The current mobile fixes improved session persistence, but they did not fully solve the auth-readiness race.

Actual root cause:
- This is now primarily an auth initialization race, not an install/cache issue.
- The app is making redirect decisions before auth restoration is definitively complete.
- Some pages also check `!user` directly without an explicit “auth is ready” guard.

Files to update:
1. `src/contexts/AuthContext.tsx`
2. `src/components/shop/ShopProtectedRoute.tsx`
3. `src/pages/shop/Checkout.tsx`
4. `src/pages/shop/ShopAuth.tsx`
5. Review `src/contexts/ShopCartContext.tsx` for any guest/logged-in initialization that should wait for auth readiness

Implementation plan:
1. Add an explicit auth readiness flag in `AuthContext`
- Add `isAuthReady` to the context value.
- Hydrate auth with `supabase.auth.getSession()` first.
- Mark auth ready only after the initial session restoration step completes.
- Do not let a null early auth event force the app into a signed-out state before hydration finishes.

2. Restructure auth initialization
- Separate “session restoration” from “profile/admin loading”.
- Restore `session` and `user` first, set `isAuthReady=true`, then run profile/admin side-effects afterward.
- Keep `onAuthStateChange` lightweight and non-blocking.
- Ignore or safely handle early `INITIAL_SESSION`/null-state behavior so it cannot trigger a checkout redirect.

3. Gate redirects with auth readiness
- Update `ShopProtectedRoute` to wait for `isAuthReady` before redirecting.
- Until auth is ready, show the loader.
- Only redirect when `isAuthReady === true` and there is still no valid user/session.

4. Fix checkout page fallback behavior
- `Checkout.tsx` currently shows “sign in” based on `!user` alone.
- Change it to wait for auth readiness before showing any signed-out UI.
- This prevents false login prompts during mobile hydration.

5. Fix auth page navigation
- `ShopAuth.tsx` currently navigates during render when `user` exists.
- Move that redirect into an effect gated by `isAuthReady && user`.
- This avoids navigation side-effects during unstable auth initialization.

6. Optional hardening in cart provider
- If needed, make logged-in vs guest cart initialization wait for `isAuthReady`.
- This avoids cart/provider state being initialized from the wrong auth state during mobile startup.

Why this should fix the issue:
- It removes the race where mobile users are redirected before their restored session is available to route guards.
- It matches the evidence from the auth logs: users are authenticated in the backend, but the frontend is deciding too early.
- It is compatible with the already-published mobile app because the fix is entirely in the web layer loaded inside the mobile shell.

Technical notes:
- I will preserve the existing mobile session persistence guard.
- I will avoid awaiting Supabase calls directly inside the auth state callback.
- I will keep the route behavior unchanged once auth is actually resolved; only the timing of redirect decisions will change.
