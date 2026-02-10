

# Add Signup Platform Tracking to Customers

## Overview

Track whether each customer signed up via the **web app** or the **mobile app**, and display this as a filterable column in the admin Customers page. This helps you understand which platform your ads are driving users to.

## How It Works

- A new `signup_platform` column is added to the `profiles` table
- During signup, the frontend detects whether the user is on the web app or mobile app and sends that info along with the registration
- The admin Customers page gets a new "Platform" column and filter dropdown

## Changes

### 1. Database: Add `signup_platform` column to `profiles`

Add a text column `signup_platform` with a default of `'web'`. Existing users will get `'web'` as default.

```sql
ALTER TABLE public.profiles ADD COLUMN signup_platform text DEFAULT 'web';
```

### 2. Backend: Accept platform in `auth-register` edge function

Update the `auth-register` edge function to accept a `platform` field in the request body and save it to the profile when creating it.

### 3. Frontend: Send platform during signup

In `AuthContext.tsx`, pass `signup_platform: 'web'` in the `auth-register` call body. The mobile app will send `'mobile'` from its side.

### 4. Admin Customers page: Show platform column and filter

- Add `signup_platform` to the `CustomerProfile` interface
- Add a "Platform" column to the table (with a phone/monitor icon badge)
- Add a Platform filter dropdown (All / Web / Mobile)
- Include platform in CSV export

## Files Modified

- **Database migration** -- add `signup_platform` column to `profiles`
- `supabase/functions/auth-register/index.ts` -- accept and store `platform` field
- `src/contexts/AuthContext.tsx` -- send `signup_platform: 'web'` in registration body
- `src/pages/admin/Customers.tsx` -- add Platform column, filter, and CSV export field

## No Regressions

- Existing profiles get `'web'` as default (safe assumption for current users)
- Mobile app signup flow is unaffected (it can be updated separately to send `'mobile'`)
- No changes to login, session, or other auth flows
- All existing filters and features on the Customers page remain intact
