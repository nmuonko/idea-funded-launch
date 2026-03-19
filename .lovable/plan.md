

## Problem

The React Native mobile app is a **separate codebase** from this web project. All web frontend fixes (AuthContext, ShopProtectedRoute, etc.) have zero effect on the RN app. The .aab builds are frozen and cannot be updated.

### Root Cause Found

The `auth-me` edge function has a **wrong column query** on line 73:

```typescript
// CURRENT (BROKEN):
.eq("id", user.id)      // looks for profile.id = auth_user_id → always returns null

// CORRECT:
.eq("user_id", user.id) // looks for profile.user_id = auth_user_id → returns the profile
```

**Evidence:**
- Profile table: `id = 3922dea2...`, `user_id = f212b025...`
- Auth user ID: `f212b025...`
- Query `.eq("id", "f212b025...")` returns null — profile not found
- `auth-me` returns `profile: null` to the RN app for ALL users
- The RN app receives `profile: null`, interprets this as "not fully set up", and redirects to login when the user tries to checkout
- Backend logs confirm: the reporting user (`kadimisha@gmail.com`) successfully authenticates via `auth-me` but **never reaches** `mobile-orders` or `mobile-checkout` — the redirect happens client-side before any checkout API call

### Why Previous Fixes Failed

Every fix so far modified web frontend files (`AuthContext.tsx`, `ShopProtectedRoute.tsx`, `Checkout.tsx`). The React Native app does not load any of these files. It calls backend edge functions directly via HTTP.

## Fix

### 1. Fix `auth-me` edge function (the actual bug)
Change line 73 from `.eq("id", user.id)` to `.eq("user_id", user.id)` so the RN app receives the user's actual profile data instead of `null`.

### 2. Harden `mobile-orders` auth error handling
Currently returns HTTP 401 on auth failures. The RN app's error handler catches 401 → signs out → redirects to login. Change to return HTTP 200 with JSON error body (matching `mobile-checkout`'s pattern), so expired tokens trigger a retry instead of a destructive sign-out.

### Technical Details

| Item | Detail |
|------|--------|
| Root cause | `auth-me` queries `.eq("id", user.id)` instead of `.eq("user_id", user.id)` |
| Effect | ALL RN app users get `profile: null`, blocking checkout |
| Files changed | `supabase/functions/auth-me/index.ts`, `supabase/functions/mobile-orders/index.ts` |
| Deployment | Edge functions auto-deploy; works with frozen .aab builds |
| Risk | Low — corrects a data query bug; no schema changes |

