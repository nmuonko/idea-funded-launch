

# Fix: Email Verification Redirect for Web App Users

## Problem

When a web app user registers, the verification email link redirects to the mobile app domain (whatever `FRONTEND_BASE_URL` is set to) instead of the web app's `/email-confirmed` page. Both web and mobile users go through the same `auth-register` and `auth-resend-verification` edge functions, but the redirect URL is hardcoded to a single `FRONTEND_BASE_URL`.

## Solution

Make the edge functions dynamically choose the correct redirect URL based on request origin:

1. The **web frontend** will pass its own origin URL in the request body
2. The **edge functions** will use that origin (with validation) for the redirect, falling back to `FRONTEND_BASE_URL` for mobile

## Changes

### 1. Edge Function: `auth-register/index.ts`

- Accept an optional `redirectBaseUrl` field from the request body
- Validate it against a whitelist of allowed domains (the published web app URL and preview URL)
- Use it for the `redirectTo` parameter in `generateLink` instead of always using `FRONTEND_BASE_URL`

### 2. Edge Function: `auth-resend-verification/index.ts`

- Same change: accept optional `redirectBaseUrl` in the request body
- Validate and use it for the verification link redirect

### 3. Frontend: `src/contexts/AuthContext.tsx`

- Pass `redirectBaseUrl: window.location.origin` in the `auth-register` request body
- This ensures the verification email will redirect back to the web app

### 4. Frontend: Resend verification call (if any)

- Also pass `redirectBaseUrl: window.location.origin` when calling `auth-resend-verification`

## Technical Details

### Allowed origins whitelist (validated in edge functions)

```text
- https://idea-funded-launch.lovable.app (published web app)
- https://id-preview--*.lovable.app (preview URLs)
- FRONTEND_BASE_URL value (mobile app / default)
```

### Edge function redirect logic

```text
1. Check if request body contains `redirectBaseUrl`
2. Validate against whitelist
3. If valid, use it; otherwise fall back to FRONTEND_BASE_URL
4. Build redirectTo as `${selectedBaseUrl}/email-confirmed`
```

### Files Modified

- `supabase/functions/auth-register/index.ts` -- accept and validate `redirectBaseUrl`
- `supabase/functions/auth-resend-verification/index.ts` -- accept and validate `redirectBaseUrl`
- `src/contexts/AuthContext.tsx` -- pass `window.location.origin` as `redirectBaseUrl`

### No-Regression Safeguards

- Mobile app requests (which don't send `redirectBaseUrl`) continue using `FRONTEND_BASE_URL` as before
- The whitelist prevents open redirect vulnerabilities
- No database changes required

