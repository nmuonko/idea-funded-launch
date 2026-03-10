

# Plan: Remove Email Verification Requirement

## What Changes

This requires changes in **both backend and frontend**. The goal is to let users create an account and immediately sign in without needing to verify their email first.

### 1. Enable Auto-Confirm in Auth Config
Use the auth configuration to enable automatic email confirmation so new signups are instantly verified.

### 2. Backend: Update `auth-service` Edge Function
In `supabase/functions/auth-service/index.ts`:
- **Registration** (line ~174): Change `email_confirm: false` to `email_confirm: true` in `admin.createUser()` — this auto-confirms the user at creation time
- **Registration response** (lines ~231-254): Remove the `needsEmailConfirmation` / `emailVerificationRequired` flags; return a direct success with session tokens since sign-in will now succeed immediately
- **Login** (line ~268): Remove the `EMAIL_NOT_VERIFIED` error branch since all users will be auto-confirmed
- **Skip sending verification email** (lines ~188-205): Remove or skip the magic link verification email send block
- Keep the `resend-verification` and `check-verification` handlers but make them no-ops or return "already verified"

### 3. Frontend: Update Auth Flow
- **`src/pages/shop/ShopAuth.tsx`**: Remove the `mode === 'verify'` screen and the redirect to verification on "Email not confirmed" error. After successful registration, go straight to the logged-in state
- **`src/pages/Profile.tsx`**: Remove the email verification banner (lines ~235-250)
- **`src/contexts/AuthContext.tsx`**: Remove any logic that checks `email_confirmed_at` for gating access
- **`src/pages/EmailConfirmed.tsx`** and **`src/pages/AuthCallback.tsx`**: These pages can stay but won't be needed for new signups anymore

### 4. Database: Update RLS Policies
The `is_email_verified()` check in RLS policies on `orders`, `checkout_sessions`, and `payment_attempts` currently blocks unverified users from placing orders. Update these policies to remove the `AND public.is_email_verified() = true` condition so all authenticated users can checkout:
- `orders` INSERT policy
- `checkout_sessions` INSERT policy  
- `payment_attempts` INSERT policy

### 5. Deploy
- Deploy updated `auth-service` edge function
- Run database migration for RLS policy updates

### Summary of Files to Change
- `supabase/functions/auth-service/index.ts` — remove verification email sending, auto-confirm users, clean up response
- `src/pages/shop/ShopAuth.tsx` — remove verify mode/screen
- `src/pages/Profile.tsx` — remove verification banner
- `src/contexts/AuthContext.tsx` — remove email_confirmed_at checks
- New SQL migration — update 3 RLS policies to drop `is_email_verified()` check

