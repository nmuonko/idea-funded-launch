
# Dynamic Platform Detection for All Users

## Problem
Currently, `signup_platform` is only set during registration via `auth-register`. This means:
- Existing users who registered before the fix are all stuck as "web"
- Users who registered on web but later switch to mobile (or vice versa) are never updated
- There's no ongoing tracking of which platform a user is actively using

## Solution

Add automatic platform detection to `mobile-get-cart` -- the most frequently called authenticated endpoint (called on every cart view, app open, and page load by both web and mobile apps). When the detected platform differs from what's stored, update the profile silently.

### Step 1: Add `last_active_platform` Column to Profiles

Add a new column to track the most recent platform separately from `signup_platform`:

```sql
ALTER TABLE profiles ADD COLUMN last_active_platform text DEFAULT NULL;
```

This keeps `signup_platform` as a historical record of how the user first registered, while `last_active_platform` reflects their current/most recent usage.

### Step 2: Modify `mobile-get-cart` Edge Function

At the top of the function (after auth verification), add ~10 lines to detect the client platform and update the profile if needed:

```
1. Import `isMobileClient` from `_shared/mobileCatalogHandler.ts`
2. After `verifyAndGetUser()`, detect platform via `isMobileClient(req)`
3. Fire-and-forget update: set `last_active_platform` on the profile
4. Also backfill `signup_platform` if it's currently NULL
```

This is a non-blocking "fire and forget" update -- it won't slow down the cart response.

### Step 3: Backfill Existing Users via One-Time Query

For the 18 existing users currently showing `signup_platform = 'web'`, we cannot retroactively determine their actual signup platform (no historical UA data exists). However, once they open the app again (web or mobile), `last_active_platform` will be set automatically.

For the admin Customers page, we'll use `last_active_platform` as the display value (falling back to `signup_platform`).

### Step 4: Update Admin Customers Page Display

Modify the platform display column in `src/pages/admin/Customers.tsx` to prefer `last_active_platform` over `signup_platform`, so the admin always sees the most recent platform the user used.

---

## Files to Modify

| File | Change |
|------|--------|
| Database migration | Add `last_active_platform` column to `profiles` |
| `supabase/functions/mobile-get-cart/index.ts` | Add ~10 lines for platform detection + profile update after auth |
| `src/pages/admin/Customers.tsx` | Display `last_active_platform` with fallback to `signup_platform` |

## How It Works Going Forward

1. **New user signs up** -- `auth-register` sets `signup_platform` correctly via UA detection (already working)
2. **Any user opens the app** -- `mobile-get-cart` detects their platform and updates `last_active_platform` automatically
3. **Admin views customers** -- sees the most recent platform each user used, not just their signup platform
4. **No frontend app changes needed** -- detection happens entirely in the backend edge function
