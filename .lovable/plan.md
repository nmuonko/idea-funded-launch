

# Fix: All Email Links Must Redirect to afrishop-usa.com

## Problem

Two issues prevent email verification and password reset links from landing on `https://afrishop-usa.com`:

1. The `resolveRedirectBase` whitelist in `auth-register` and `auth-resend-verification` edge functions does NOT include `afrishop-usa.com`. When web users on the custom domain register, their origin fails validation and falls back to the mobile `FRONTEND_BASE_URL`.

2. The password reset flow needs to consistently redirect to `afrishop-usa.com` paths.

## Changes

### 1. Edge Function: `auth-register/index.ts`

Add `https://afrishop-usa.com` and `https://www.afrishop-usa.com` to the allowed origins whitelist in the `resolveRedirectBase` function.

```text
Before:
  origin === 'https://idea-funded-launch.lovable.app' || preview regex || fallback

After:
  origin === 'https://afrishop-usa.com' ||
  origin === 'https://www.afrishop-usa.com' ||
  origin === 'https://idea-funded-launch.lovable.app' || preview regex || fallback
```

### 2. Edge Function: `auth-resend-verification/index.ts`

Same whitelist update -- add `afrishop-usa.com` and `www.afrishop-usa.com`.

### 3. No other changes needed

- `ShopAuth.tsx` already uses `window.location.origin` for password reset redirect, which will correctly resolve to `https://afrishop-usa.com` on production
- `Auth.tsx` already hardcodes `https://afrishop-usa.com/auth/reset-password` for admin password reset
- The `ResetPassword.tsx` page and `/email-confirmed` route already exist

## Files Modified

- `supabase/functions/auth-register/index.ts` -- add custom domain to whitelist
- `supabase/functions/auth-resend-verification/index.ts` -- add custom domain to whitelist

## Result

- Email verification links will redirect to `https://afrishop-usa.com/email-confirmed`
- Password reset links will redirect to `https://afrishop-usa.com/auth/reset-password`
- Mobile users (no `redirectBaseUrl`) continue using `FRONTEND_BASE_URL` as before
- Preview/staging URLs continue to work

