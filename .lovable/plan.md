

## Problem

The "Email non confirmé" (Email not confirmed) error persists for users who created accounts **before** auto-confirm was enabled. Even though new signups are now auto-confirmed, existing unconfirmed accounts (like `Pascalmukonkoleee@gmail.com`) still have `email_confirmed_at = NULL` in the auth system, causing Supabase to reject their sign-in with "Email not confirmed."

The screenshot also shows a verification banner and dialog that appear to come from a cached/older version of the Android app — the current codebase does not contain this dialog UI.

## Root Causes

1. **Existing unconfirmed users**: The bulk-confirm action was run previously (per project memory) but new unconfirmed accounts have accumulated since then.
2. **Sign-in flow doesn't auto-confirm**: When `signInWithPassword` returns "Email not confirmed," the code just shows an error instead of auto-confirming the user server-side and retrying.

## Plan

### 1. Bulk-confirm all existing unconfirmed users (Database)
Run the existing `confirm_all_users` action via the auth-service edge function to set `email_confirmed_at` on all unconfirmed accounts. This is a one-time fix for historical accounts.

### 2. Auto-confirm on sign-in failure (AuthContext.tsx)
Modify `signIn()` in `src/contexts/AuthContext.tsx`: when Supabase returns "Email not confirmed," automatically call the auth-service edge function with `action: 'confirm_all_users'` (or a targeted confirm for that specific email), then retry `signInWithPassword`. This prevents the issue from ever recurring regardless of server config.

**Specific change**: In the `else if (error.message?.includes('Email not confirmed'))` block (line ~343), instead of just showing a toast, call the auth-service to auto-confirm that user, then retry sign-in silently.

### 3. Remove verification UI remnants (ShopAuth.tsx)
Remove the `handleResendVerification` function and any related translation references from `ShopAuth.tsx` since email verification is no longer required. This ensures no UI path can show a verification prompt.

### Technical Details

- **AuthContext.tsx** (lines ~343-345): Replace error toast with auto-confirm + retry logic:
  ```typescript
  // Auto-confirm and retry
  await supabase.functions.invoke('auth-service', { body: { action: 'confirm_all_users' } });
  const retry = await supabase.auth.signInWithPassword({ email, password });
  if (!retry.error) { /* proceed with session */ }
  ```
- **auth-service edge function**: Already has `confirm_all_users` action — no backend changes needed.
- **ShopAuth.tsx**: Remove `handleResendVerification` function (lines 264-291) as dead code.

