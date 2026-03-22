

## Investigation Results

**Root cause identified**: The two failing users (`ngoyprecious@gmail.com` and `kabuyachadrack94@gmail.com`) have **no profile records** in the `profiles` table. The working user (`kadimisha@gmail.com`) has a complete profile with full_name, phone, and country.

**Why profiles are missing**: The `handle_new_user_profile` database function exists but has **no trigger** attached to `auth.users`. New user signups don't automatically create profile rows.

**Why checkout fails**: The `mobile-checkout` edge function (line 935) calls `isProfileComplete(userProfile)` which returns `false` when the profile is `null`. This returns a `PROFILE_INCOMPLETE` error (HTTP 200 with error code), which the RN app displays as the generic "Failed to process checkout" dialog.

**Why kadimisha works**: Their profile was likely created manually or via an older flow that no longer exists.

---

## Plan

### Step 1: Create the missing trigger on auth.users
Add a database trigger so `handle_new_user_profile()` fires on every new signup, auto-creating a profile row.

```sql
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user_profile();
```

### Step 2: Backfill profiles for existing users without one
Insert profiles for `ngoyprecious@gmail.com` and `kabuyachadrack94@gmail.com` (and any other users missing profiles) using their auth metadata.

```sql
INSERT INTO public.profiles (id, user_id, email, full_name, name, country, language)
SELECT gen_random_uuid(), u.id, u.email,
  COALESCE(NULLIF(TRIM(u.raw_user_meta_data->>'full_name'),''), split_part(u.email,'@',1)),
  COALESCE(NULLIF(TRIM(u.raw_user_meta_data->>'full_name'),''), split_part(u.email,'@',1)),
  'DR Congo', 'fr'
FROM auth.users u
LEFT JOIN public.profiles p ON p.user_id = u.id
WHERE p.id IS NULL;
```

### Step 3: Add fallback profile auto-creation in mobile-checkout
As a safety net, if the profile is still missing at checkout time, auto-create it from the authenticated user's metadata instead of blocking the payment. This prevents future edge cases where the trigger might not fire (e.g., SSO providers).

**File**: `supabase/functions/mobile-checkout/index.ts` (around line 935)
- Before the `isProfileComplete` check, if `userProfile` is null, upsert a default profile from `user.email` and `user.user_metadata`
- Then re-query the profile and continue with the completeness check
- Users with missing phone/country will still get the `PROFILE_INCOMPLETE` error, but at least their profile row will exist for them to edit

### Technical Details
- The trigger must be on `auth.users` (not `public.profiles`) using `AFTER INSERT`
- The backfill uses a `LEFT JOIN` to only create profiles for users who don't have one
- The mobile-checkout fallback uses `upsert` with `ON CONFLICT (user_id) DO NOTHING` to be idempotent
- The `isProfileComplete` check requires `full_name`, `phone`, and `country` — the backfill sets name and country but NOT phone, so users will still need to add their phone number before paying. This is expected behavior.

