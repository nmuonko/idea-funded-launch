

# Fix: Mobile Signup Platform Not Being Tracked

## Problem

All users show as "Web" in the admin Customers page because:
1. The `auth-register` edge function defaults `signup_platform` to `'web'` when no value is provided (line 134)
2. The mobile app likely calls `auth-register` without explicitly sending `signup_platform: 'mobile'`
3. Current database: all 18 users have `signup_platform = 'web'`

## Solution

### 1. Auto-detect platform in the `auth-register` edge function

Instead of relying on the client to send the correct value, the edge function should detect the platform from the request's `User-Agent` header as a fallback. This way even if the mobile app forgets to send `signup_platform`, it still gets classified correctly.

**File: `supabase/functions/auth-register/index.ts`**

- After reading `signupPlatform` from the body, add a fallback:
  - If the body explicitly says `'mobile'`, use it
  - If the body says `'web'` or is missing, check the `User-Agent` header for mobile indicators (e.g., contains "Dart", "okhttp", "Mobile", "Android", "iPhone", or the app's custom user agent)
  - If the User-Agent looks like a mobile client, override to `'mobile'`

```text
Logic:
  let signupPlatform = body.signup_platform || body.signupPlatform || null;
  if (!signupPlatform || signupPlatform === 'web') {
    const ua = req.headers.get('user-agent') || '';
    const isMobileUA = /dart|okhttp|android|iphone|mobile|afrishop/i.test(ua);
    signupPlatform = isMobileUA ? 'mobile' : 'web';
  }
```

### 2. Fix existing users (optional data correction)

Run a one-time update if you know which users signed up via mobile. Since we can't retroactively determine this from the current data, this would need manual identification. Going forward, new signups will be tracked correctly.

---

## Files to Modify

| File | Change |
|------|--------|
| `supabase/functions/auth-register/index.ts` | Add User-Agent-based platform detection as fallback (around line 134) |

## Why This Works

- The mobile app (Flutter/React Native) sends a distinctly different User-Agent than a web browser
- This is a server-side fix -- no changes needed to the mobile app
- Explicit `signup_platform: 'mobile'` from the mobile app still takes priority if sent

