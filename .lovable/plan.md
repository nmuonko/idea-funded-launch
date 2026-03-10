

## Analysis

The edge function logs confirm `catalog-home` is deployed and serving mobile requests successfully — all recent mobile hits show `recipe_cache_hit` with 200 responses. There are **zero 404s in the server logs**.

This confirms the 404 is being served **from the Android OkHttp disk cache on the device itself** — the request never reaches the server. The `Cache-Control: no-store` headers we added only affect NEW responses; they cannot retroactively invalidate an already-cached 404 in OkHttp's local disk cache.

### Why the cached 404 persists

OkHttp's cache key is the full URL. Your mobile app always hits the exact same URL:
```
GET .../functions/v1/catalog-home?page=1&pageSize=20&mode=auto&amazon_domain=amazon.com
```
The old 404 response (from the migration period) had no `Cache-Control` header, so OkHttp applied heuristic caching — potentially days or weeks.

### The fix: Backend-driven cache bust via `catalogApiBaseUrl`

The mobile app calls `getPublicCartConfig()` → `mobile-public-config` **before** calling `catalog-home`. It uses the returned `catalogApiBaseUrl` to construct the catalog URL. Currently it returns:
```
https://igmkhxffnyzoogcqvdab.supabase.co/functions/v1
```

We can't add query params to the base URL (it's used as a path prefix). But we CAN leverage a different approach:

**Plan: Add a `catalogCacheBuster` field to the `mobile-public-config` response.**

The mobile app already appends query params to the URL. If we return a `catalogCacheBuster` value from config, the app would need to append it. But since the app code is frozen...

**Revised approach**: Since the mobile app code is frozen, the only option is:

1. **Instruct affected users to clear the app cache** (Settings → Apps → AfriShop → Clear Cache on Android). This is the immediate fix.

2. **For long-term prevention**: The `no-store` headers we already added ensure this can never happen again — any future error responses will not be cached by OkHttp.

3. **Optional server-side mitigation**: Check if `mobile-public-config`'s `Cache-Control: public, max-age=300` is also causing OkHttp to cache it. Change it to `no-store` as well, ensuring config is always fresh. This doesn't fix the catalog-home cache directly, but prevents config staleness.

### What to communicate to users

Since the app code is frozen and OkHttp doesn't provide a backend-controlled cache-invalidation mechanism, the affected users need to clear their app cache once. After that, the `no-store` headers will prevent any future caching issues.

### Changes

| File | Change |
|------|--------|
| `supabase/functions/mobile-public-config/index.ts` | Change `Cache-Control` from `public, max-age=300` to `no-store, no-cache, must-revalidate` with `Pragma: no-cache` |

This is a single-line change and ensures `mobile-public-config` also never gets stale-cached by OkHttp.

