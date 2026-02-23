
# Fix: `admin-system-health` BOOT_ERROR

## Problem Found

The `admin-system-health` edge function crashes on startup with:

```
Uncaught SyntaxError: The requested module '../_shared/auth.ts' does not provide an export named 'authErrorResponse'
```

It imports two functions that don't exist in `_shared/auth.ts`:
- `verifyAdminAuth` -- does not exist
- `authErrorResponse` -- does not exist

This is the **only** broken function found across the entire system. All other health endpoints (general `health`, `catalog-health`, `payment-health`, `mobile-health`, `stripe-health`) return 200 OK.

## Fix

Replace the non-existent imports with equivalent functions that already exist in `_shared/auth.ts`:

| Broken Import | Replacement |
|---|---|
| `verifyAdminAuth` | `verifyAndGetUser` (validates JWT, returns user object) + admin role check |
| `authErrorResponse` | `errorResponse` (generic JSON error response) |

### Changes to `supabase/functions/admin-system-health/index.ts`

1. **Line 3**: Change import from `verifyAdminAuth, authErrorResponse` to `verifyAndGetUser, errorResponse, handleCors, AuthError, createAdminClient`
2. **Lines 63-73**: Replace the auth block to use `verifyAndGetUser` with an admin role check against the `user_roles` table
3. **Line 75-78**: Use `createAdminClient()` instead of manually creating a client with service role key

The admin check will query `user_roles` for `role = 'admin'`, consistent with how other admin functions in the project verify authorization.

### Deployment

Redeploy `admin-system-health` after the fix.

## What Was NOT a Bug

- **Rainforest API 402 errors**: External billing issue (their API key needs payment update), not a code bug. The circuit breaker handles this correctly by serving from DB cache.
- **"No images found" logs**: Expected when Rainforest returns errors -- the media cache gracefully skips those items.
- **Frontend postMessage warnings**: Standard Lovable platform messages, not application bugs.
