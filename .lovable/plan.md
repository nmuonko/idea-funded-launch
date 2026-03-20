

## Problem Analysis

After examining the backend logs and code, I found:

1. **Backend IS succeeding** — logs show `[CART_ADD] Inserted item` and `upstreamStatus=200` for recent calls. Items ARE being written to the database.

2. **But `handleAddItem` has a critical auth inconsistency** — it uses the **strict** `extractBearerToken` (line 382) which requires exact `Bearer ` prefix, while all other handlers (`get_cart`, `sync`, `merge_guest`, `delete_item`, `update_item`) use the **flexible** `extractRequestToken` which supports raw JWTs and alternate headers.

3. **Silent guest fallback** — When `extractBearerToken` fails (no `Bearer ` prefix, token in alternate header), `handleAddItem` silently sets `isGuest = true` and returns `{success: true, isGuest: true}` **without saving to the database**. The RN app thinks the add succeeded, but the item was never persisted. The next `get_cart` call returns the old state.

4. **Delete/update work differently** — They use `verifyAndGetUser` which throws `AuthError` on failure, caught by the global handler as a 200 with `authenticated: false`. This is correct.

5. **Missing diagnostic logging** — `handleAddItem` doesn't log whether the user was treated as guest or authenticated, making it invisible in logs.

## Root Cause

After a fresh reinstall, the RN app's auth token may arrive in a non-standard format (raw JWT, alternate header). `handleAddItem` rejects it silently, treats the user as guest, returns a fake success, and never saves the item. The cart appears empty on refresh.

## Implementation Plan

### 1. Fix `handleAddItem` auth extraction
- Replace `extractBearerToken(authHeader)` with `extractRequestToken(req)` (line 382)
- This matches the pattern used by `handleSync`, `handleMergeGuest`, and all other handlers

### 2. Add explicit auth failure response
- When a token IS present but verification fails, return `{ok: false, authenticated: false, code: "SESSION_EXPIRED"}` instead of silently falling through to guest mode
- Only allow guest mode when genuinely no token is present

### 3. Add diagnostic logging
- Log token presence, source, and whether user was treated as guest or authenticated in `handleAddItem`
- This will make the next debug cycle immediate if issues persist

### File to change
- `supabase/functions/mobile-cart/index.ts` — `handleAddItem` function (~10 lines changed)

### Expected outcome
- After reinstall, add_item will correctly extract the JWT from any header format and save items to the database
- If auth truly fails, the RN app gets `authenticated: false` instead of a fake success

