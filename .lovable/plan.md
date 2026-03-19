

## Problem: "Pay Now" redirects to login on mobile app despite being logged in

### Root Cause

In `src/contexts/AuthContext.tsx` (lines 238-255), the auth initialization checks for `localStorage.getItem('rememberMe')` and `sessionStorage.getItem('sessionActive')`. If neither is set, **the app signs the user out**:

```typescript
if (!rememberMe && !sessionActive && !isEmailConfirmPage) {
  await supabase.auth.signOut();  // ← kills the session
  ...
  return;
}
```

In the Capacitor/React Native mobile app, `sessionStorage` doesn't persist across navigation the same way as in a browser tab. When the app navigates to `/checkout` (which is wrapped in `ShopProtectedRoute`), auth re-initializes, finds no `rememberMe`/`sessionActive` flags, signs the user out, and `ShopProtectedRoute` redirects to `/shop-auth`.

### Fix

**File: `src/lib/environment.ts`** — Add a `isCapacitorApp()` helper that detects the native mobile shell (checks for `window.Capacitor` or the Capacitor user-agent pattern).

**File: `src/contexts/AuthContext.tsx`** — In the `initializeAuth` function, skip the "clear session if not remembered" logic when running inside a Capacitor/native app. Mobile apps should always persist sessions (there's no "new browser tab" concept in a native app).

The change is a single guard condition addition:

```typescript
const isNativeApp = isCapacitorApp();

if (!rememberMe && !sessionActive && !isEmailConfirmPage && !isNativeApp) {
  // Only clear session in web browser context
  await supabase.auth.signOut();
  ...
}
```

### Technical Details

| Item | Detail |
|------|--------|
| Files changed | `src/lib/environment.ts`, `src/contexts/AuthContext.tsx` |
| Detection method | `window.Capacitor` object (injected by Capacitor runtime) or user-agent containing "capacitor" |
| Risk | Low — only adds a bypass for native apps where session-clearing makes no sense |
| No migration needed | No database changes required |

