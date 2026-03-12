

# Root Cause Analysis and Fix Plan

## Two Separate Issues, Two Different Root Causes

---

### Issue 1: Mobile App — "Catalogue Indisponible" / "Backend Warning"

**Root Cause: The frozen mobile app sends `?env=staging` as a QUERY PARAMETER.**

I verified this from live analytics logs. Every single `okhttp/4.12.0` request from the mobile app includes `?env=staging` in the URL:

```text
Mobile requests (from analytics):
  GET /functions/v1/mobile-public-config?env=staging        → 200, returns env:"staging"
  GET /functions/v1/catalog-home?env=staging&page=1&...     → 200, returns envUsed:"staging"  
  GET /functions/v1/catalog-categories?env=staging          → 200, returns env:"staging"
```

The previous fix in `environmentResolver.ts` only overrides staging when it comes from the **header** (`x-afrishop-environment`). But the mobile app sends staging as a **query parameter**, which has the highest priority in the resolver and bypasses the mobile detection entirely:

```text
environmentResolver.ts line 53-54:
  const envParam = url.searchParams.get("env")?.toLowerCase().trim();
  if (envParam === "staging") return "staging";  // ← skips mobile check!
```

Similarly, `catalog-home/normalizeEnv()` has the same bypass — it explicitly allows `?env=staging` from query params via `explicitStagingQuery`.

Since the mobile build is frozen, the backend must force `production` for ALL mobile requests, including when `?env=staging` comes from query params.

**Fix:**
1. **`_shared/environmentResolver.ts`**: Move the `isLikelyMobileRequest()` check BEFORE processing query params. If mobile is detected and query param is `staging`, force `production`.
2. **`catalog-home/index.ts` `normalizeEnv()`**: Remove the `!explicitStagingQuery` exception for mobile requests. Mobile always gets production.
3. **`mobile-public-config/index.ts`**: Verify it uses `getEnvironmentFromRequest` (it does — line 832), so fix 1 covers it.
4. **`catalog-categories/index.ts`**: Line 40 calls `getEnvironmentFromRequest` but also reads `env` from query params independently. Fix to use only `getEnvironmentFromRequest`.

---

### Issue 2: Web Cart — Items Disappear on Add

**Root Cause: Needs runtime diagnosis.**

The code-level fix from the previous round (`addSucceeded` guard) IS present in the current code (line 497-519). The cart logic looks correct on paper:
- Guest: optimistic add → localStorage persist → no server call
- Logged-in: optimistic add → server add → syncCart on success only

Since the user reports this happens for both guest and logged-in, the issue is likely in the UI layer (component re-rendering, route navigation, or state reset) rather than the sync logic. I need to add diagnostic logging to `addItem` to capture exactly what happens at runtime.

**Fix:**
1. Add console diagnostic logging to `addItem`, `syncCart`, and the `items` state setter to trace the exact sequence of events
2. Verify that `setItems` inside `addItem` is not being overwritten by a concurrent `syncCart` (race condition between mount sync and add)
3. Add a guard: if `syncCart` is called within 2 seconds of an `addItem`, delay the sync to prevent the server from returning stale data that overwrites the optimistic item

---

## Implementation Steps

### Step 1: Fix `environmentResolver.ts` — Force production for mobile query params
Move the mobile detection check before the query param processing so that `?env=staging` from mobile clients is overridden to `production`.

### Step 2: Fix `catalog-home/normalizeEnv()` — Remove staging exception for mobile
Remove the `!explicitStagingQuery` guard so mobile requests are always forced to production regardless of query param source.

### Step 3: Fix `catalog-categories/index.ts` — Use only resolver
Remove the independent `url.searchParams.get("env")` and rely solely on `getEnvironmentFromRequest(req)`.

### Step 4: Fix web cart race condition in `ShopCartContext.tsx`
Add a short delay/guard to prevent `syncCart` from overwriting optimistic items immediately after `addItem`. Add diagnostic logging.

### Step 5: Deploy and verify
- Deploy all changed edge functions
- Verify `mobile-public-config`, `catalog-home`, `catalog-categories` all return `env: "production"` even when called with `?env=staging`
- Verify web cart add + persist works correctly

---

## Why Previous Fixes Failed

The previous fix was correct in concept (force production for mobile) but implemented at the wrong priority level. It only intercepted the `x-afrishop-environment` header, while the frozen mobile app sends `?env=staging` as a URL query parameter — which was processed first and returned immediately without ever reaching the mobile detection logic.

