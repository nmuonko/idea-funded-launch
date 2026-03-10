

# Plan: Fix Email Verification Still Blocking Users

## Root Cause

The auth logs confirm that as recently as 22:19:46 UTC today, GoTrue is still returning `email_not_confirmed` errors on `/token` (login). Even though the edge function code has `email_confirm: true` in `admin.createUser()`, this parameter is being **overridden by the GoTrue server-level setting** which still has email confirmation **enabled**.

The `email_confirm: true` parameter in `createUser` tells GoTrue "mark this user as confirmed," but if the server's `autoconfirm` setting is OFF, GoTrue may still enforce confirmation on `signInWithPassword`. This is the gap.

## Changes

### 1. Enable auto-confirm at the auth server level
Use `cloud--configure_auth` to set `auto_confirm_email = true`. This is the **critical missing step** — without this, GoTrue blocks login for unconfirmed users regardless of what the edge function does.

### 2. Redeploy the auth-service edge function
The deployed version may be stale. Redeploy to ensure `email_confirm: true` and the `confirm_all_users` action are live.

### 3. Bulk-confirm all existing unconfirmed users
Call the `confirm_all_users` action on the auth-service edge function to confirm users like `kadimisha@gmail.com` and `valeriekanam@gmail.com` who were created before/during this transition.

### 4. Verify the fix
Test registration and login via curl to the edge function to confirm no `email_not_confirmed` errors.

## No frontend code changes needed
The frontend code is already correct — it handles auto-confirm flow properly.

