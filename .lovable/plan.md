

## Diagnosis Summary

### Server-Side Status: Both endpoints are LIVE and HEALTHY
- `catalog-home` → 200 OK, valid data, `Cache-Control: no-store` headers confirmed
- `mobile-public-config` → 200 OK, correct `catalogApiBaseUrl`, `no-store` headers confirmed
- **Zero 404 errors** in `catalog-home` server logs — the 404 never reaches the backend

### Root Cause: Likely a combination of two factors

**Factor 1: OkHttp disk cache on affected devices**
Devices that cached a 404 during the "Bundle generation timed out" deployment window still serve that cached error. The `no-store` headers only affect NEW responses and cannot retroactively invalidate existing cached 404s.

**Factor 2: `catalog-home` is missing from `config.toml`**
The `config.toml` does NOT include a `[functions.catalog-home]` entry with `verify_jwt = false`. While the function is currently deployed and responding (likely because it was deployed via the CLI which ignores config.toml), this missing entry could cause issues during redeployment or gateway routing in certain edge regions. Adding it ensures the Supabase gateway consistently routes to the function without JWT enforcement.

### Why "fresh installs are more likely to hit it"
The "Bundle generation timed out" errors from the recent deployment attempts may have left the function in an inconsistent deployment state across Deno Deploy edge regions. Users in regions where the function didn't fully propagate would get a gateway-level 404. Old users with cached successful responses from before the failed deployment would continue working from OkHttp cache.

---

## Plan: Minimal Production Hotfix

### 1. Add `catalog-home` (and other missing catalog functions) to `config.toml`

**File**: `supabase/config.toml`

Add entries for all catalog functions that are currently missing but actively called by the mobile app:
```toml
[functions.catalog-home]
  verify_jwt = false
[functions.catalog-search]
  verify_jwt = false
[functions.catalog-product]
  verify_jwt = false
[functions.catalog-category]
  verify_jwt = false
[functions.mobile-public-config]
  verify_jwt = false
[functions.catalog-prewarm-home]
  verify_jwt = false
```

This ensures the Supabase gateway always routes to these functions without JWT enforcement, regardless of deployment state.

### 2. Force-redeploy `catalog-home`

Redeploy the function to ensure full global propagation across all Deno Deploy edge nodes. This clears any stale deployment state from the previous "Bundle generation timed out" failures.

### 3. Verify post-deployment

- Curl test `catalog-home` with mobile headers
- Confirm 200 OK with valid sections data
- Confirm `Cache-Control: no-store` headers are present

### No other changes needed
- `catalog-home` code is correct (already has no-store headers, mobile detection, fallback logic)
- `mobile-public-config` code is correct (already has no-store headers, correct `catalogApiBaseUrl`)
- Search and other endpoints are unaffected

### User-side recovery for devices with cached 404s
After the redeploy, affected users need to **clear app cache once** (Settings → Apps → AfriShop → Clear Cache on Android). After that, the `no-store` headers prevent any future caching issues.

### Files to change
| File | Change |
|------|--------|
| `supabase/config.toml` | Add 6 missing function entries with `verify_jwt = false` |

### Post-deploy verification
Force-redeploy `catalog-home` and test with curl to confirm global availability.

