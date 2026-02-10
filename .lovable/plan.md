

# Fix: Auto-Login After Email Verification

## Root Cause

When a user clicks the verification link in their email, it opens in a **new browser tab**. In this new tab:

1. There is no `rememberMe` in localStorage (user hasn't signed in yet in this tab)
2. There is no `sessionActive` in sessionStorage (it's a fresh tab)
3. AuthContext sees this and **immediately signs the user out** (line 227 in AuthContext.tsx)
4. This destroys the session that the verification link was about to establish
5. So even though `EmailConfirmed.tsx` detects a session briefly via `supabase.auth.onAuthStateChange`, the AuthContext kills it

The popup shows because the `EmailConfirmed` page's own listener catches the session before AuthContext wipes it. But by the time the user navigates to the homepage, the session is gone.

## The Fix

### 1. `src/contexts/AuthContext.tsx` - Skip session clearing on email confirmation page

Add the `/email-confirmed` path to the list of exceptions (alongside recovery flow and reset password page). When the user lands on `/email-confirmed`, we must NOT clear the session -- we need it to auto-log them in.

Also set `sessionActive` in sessionStorage when a session is detected on the email-confirmed page, so the session persists after navigation.

```typescript
const isEmailConfirmPage = window.location.pathname === '/email-confirmed';

if (!rememberMe && !sessionActive && !isRecoveryFlow && !isResetPasswordPage && !isEmailConfirmPage) {
  // Clear session...
}
```

### 2. `src/pages/EmailConfirmed.tsx` - Set sessionActive flag before navigating

When the user clicks "OK" on the popup, set `sessionActive` in sessionStorage so that when they land on the homepage, AuthContext doesn't clear the session.

```typescript
const handleDismiss = () => {
  sessionStorage.setItem('sessionActive', 'true');
  setShowPopup(false);
  navigate("/", { replace: true });
};
```

## Files Modified

- `src/contexts/AuthContext.tsx` -- add `/email-confirmed` to the session-clearing exceptions
- `src/pages/EmailConfirmed.tsx` -- set `sessionActive` flag before navigating to homepage

## Why This Is Safe

- The verification link is a one-time token; it can't be reused
- We only skip session clearing on the specific `/email-confirmed` route
- The `sessionActive` flag is in sessionStorage, so it expires when the browser tab/window closes
- No changes to the sign-in, sign-out, or remember-me logic

