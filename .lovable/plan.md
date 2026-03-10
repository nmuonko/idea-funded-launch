

# Plan: Fix "Email Not Confirmed" — Users Still Blocked

## Problem
The auth logs show users are **still getting `email_not_confirmed` errors** right now. There are **181 existing users** in the database with `email_confirmed_at = NULL` who cannot log in. The edge function code is correct (`email_confirm: true`) and deployed, but existing users created before this change remain unconfirmed.

## Changes Required

### 1. Add temporary `confirm_all_users` action to auth-service
In `supabase/functions/auth-service/index.ts`:
- Add `'confirm_all_users'` to `SUPPORTED_ACTIONS` array (line 552)
- Add a case in the switch (after line 594) that uses `admin.auth.admin.listUsers()` to find all users with `email_confirmed_at = null` and calls `admin.auth.admin.updateUserById(id, { email_confirm: true })` on each
- This is a one-time operation to backfill the 181 unconfirmed users

### 2. Deploy and call the bulk confirm
- Deploy auth-service
- Call `confirm_all_users` action via curl to confirm all 181 users
- Then remove the action from the code (or leave it — it's idempotent)

### 3. Fix frontend error message in AuthContext
In `src/contexts/AuthContext.tsx` line 343-344:
- Change the "Email not confirmed" error message from "Your email is not yet verified. Please verify your email to sign in." to a generic "Unable to sign in. Please try again or contact support." — since verification is no longer required, this error should never appear, but if it does, users shouldn't see a confusing verification message

### 4. Remove leftover verification UI translations (optional cleanup)
The `verifyEmail`, `verifyEmailSubtitle`, `verifyEmailNote` translations in `src/lib/i18n/translations.ts` (lines ~949-952) are no longer needed but harmless.

## What This Fixes
- All 181 existing unconfirmed users will be able to log in immediately
- All new users are already auto-confirmed via `email_confirm: true` in the edge function
- The French message "Veuillez vérifier votre boîte de réception..." will no longer appear

