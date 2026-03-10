

## Diagnosis

The "Réessayer" (retry) button does nothing visible because of **two separate issues** depending on whether the user is on the web or mobile app:

### Web App Issue
`handleFullRetry` in `ShopHome.tsx` uses an indirect approach — it resets refs and increments `retryCount` to re-trigger a `useEffect`. This is fragile. There is already a dedicated `fetchAccueilFeed(forceRefresh)` function (line 460) that properly sets `accueilLoading(true)`, clears errors, and fetches with `skipCache: true`. But `handleFullRetry` doesn't use it — it relies on a `useEffect` that first fetches pinned items from a database table before starting the homepage feed, adding delay and failure points.

Additionally, `handleFullRetry` does NOT set `setAccueilLoading(true)`, so for a brief window the user sees an empty page (not loading skeleton, not error, not products — just blank space).

### Mobile App Issue
The mobile app's "Réessayer" button retries the same URL. OkHttp (Android HTTP client) serves the stale cached 404 response without ever reaching the server. Server logs confirm: **zero production mobile requests** hit `catalog-home` — only staging test hits and web hits appear. This proves the request never leaves the device.

The mobile app also has a fallback URL pattern `catalog/home` (with slash), but **no such edge function exists** — it would also 404.

## Plan

### 1. Fix web retry — use `fetchAccueilFeed` directly

**File**: `src/pages/shop/ShopHome.tsx`

Replace `handleFullRetry` to:
- Call `clearAllCatalogCache()` to wipe localStorage + memory caches
- Reset category state and refs
- Call `fetchAccueilFeed(true)` directly — this already handles `setAccueilLoading(true)`, error clearing, `skipCache: true` with `_cb=<timestamp>` cache-buster, and `cache: 'no-store'` fetch option

### 2. Create `catalog/home` fallback function for mobile

**New file**: `supabase/functions/catalog-home-fallback/index.ts`

This is a lightweight proxy that forwards requests to `catalog-home`. It catches mobile apps that fall back to the `/catalog/home` path pattern.

Wait — Supabase routes functions by folder name only, so we can't create a `catalog/home` path. The mobile fallback URL `catalog/home` would map to a function folder `catalog` which would conflict with naming.

Instead: Check if the mobile app's fallback is actually `catalog-home` with a different path — let me re-verify.

Looking at the earlier context: the primary URL is `/catalog-home` (hyphen) and fallback is `/catalog/home` (slash). Supabase can't route `/catalog/home` as a function name. So the fallback always 404s regardless.

### Revised approach for mobile

Since we can't create a `/catalog/home` route and can't change the mobile app code, the only server-side fix is to **change the `catalogApiBaseUrl`** returned by `mobile-public-config` to include a cache-busting query parameter in the path.

The mobile app constructs: `${baseUrl}/catalog-home?page=1&...`

If we change baseUrl from:
`https://igmkhxffnyzoogcqvdab.supabase.co/functions/v1`
to:
`https://igmkhxffnyzoogcqvdab.supabase.co/functions/v1` (same — can't change without breaking URL)

We CANNOT add query params to the base URL without breaking the path construction.

**The mobile fix is limited to**: Ensuring the server is healthy (confirmed) and waiting for OkHttp cached 404s to expire naturally. Users can force-clear by killing + reopening the app or clearing cache in device settings.

### Summary of changes

| File | Change |
|------|--------|
| `src/pages/shop/ShopHome.tsx` | Rewrite `handleFullRetry` to directly call `fetchAccueilFeed(true)` instead of relying on useEffect re-trigger |

This ensures the web "Réessayer" button immediately shows loading state and fetches fresh data with full cache bypass.

For mobile users: The server is confirmed working. The `no-store` headers are active. The issue is purely OkHttp disk cache on devices. Users need to either restart the app (kill + reopen, not just retry) or clear app cache once in device settings.

