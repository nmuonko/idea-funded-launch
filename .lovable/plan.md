

## Problem Analysis

Two issues reported:

1. **"Payez maintenant" redirect after reinstall** — The `mobile-cart` edge function still returns raw HTTP 401 in 5+ places. The frozen React Native app's global interceptor catches any 401 and forces a logout/redirect.

2. **Deleted item reappears after a few seconds** — After a successful delete, `syncCart()` is called. If that sync call hits a 401 (from the same `mobile-cart` function), the sync fails silently. On the next automatic sync or state reconciliation, the server still has the item deleted, but the client never received the updated list, so the old cached state (with the item) gets restored.

Both issues trace to the same root cause: `mobile-cart/index.ts` still returns raw 401 status codes.

## Locations in `mobile-cart/index.ts` returning raw 401

| Line | Context |
|------|---------|
| 405 | `AUTH_REQUIRED_FOR_MANUAL_PRICE` |
| 688 | `sync` action — no token |
| 692 | `sync` action — invalid token |
| 828 | `merge_guest` action — no Bearer header |
| 833 | `merge_guest` action — invalid token |
| 1053 | Global catch — `AuthError` fallback |

All six must be changed to return **HTTP 200** with a JSON error body containing `authenticated: false` and a stable error code — matching the pattern already applied to `mobile-checkout`, `payments-provider`, and `payments-core`.

## Implementation Plan

### 1. Harden `mobile-cart/index.ts` auth responses

Replace all raw 401 returns with HTTP 200 + structured JSON:
```
{ ok: false, authenticated: false, code: "AUTH_REQUIRED", message: "...", activeItems: [], savedItems: [] }
```

Specific changes:
- **Line 405**: Return 200 with `code: "AUTH_REQUIRED_FOR_MANUAL_PRICE"`
- **Line 688**: Return 200 with `code: "AUTH_REQUIRED"`
- **Line 692**: Return 200 with `code: "SESSION_EXPIRED"`
- **Line 828**: Return 200 with `code: "AUTH_REQUIRED"`
- **Line 833**: Return 200 with `code: "SESSION_EXPIRED"`
- **Line 1053**: Global catch — return 200 instead of `error.status || 401`

Also update `sync` and `merge_guest` to use the shared `extractRequestToken` / `verifyAndGetUser` helper (from `_shared/auth.ts`) instead of strict `Bearer ` prefix checks, matching the pattern in `payments-provider` and `payments-core`.

### 2. Deploy and verify

- Deploy `mobile-cart` edge function
- Test the delete + sync flow to confirm no 401s leak through

### Files to change
- `supabase/functions/mobile-cart/index.ts` (6 locations)

### Expected outcome
- The frozen RN app will never receive a 401 from cart operations, preventing forced logouts
- Delete → sync flow will complete successfully, so deleted items won't reappear
- Both issues (payment redirect + ghost items) resolved from this single fix

