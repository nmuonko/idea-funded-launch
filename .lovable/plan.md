

## Problem

When mobile users see a 404 error on the home screen and tap "Retry", the request goes through `cachedCatalogFetch` which uses `fetch()` with `cache: 'default'`. The Android WebView/HTTP cache may have stored the 404 response from during the migration, and the browser serves it from its own cache without hitting the network. The app's localStorage cache correctly does NOT cache errors, but the browser-level HTTP cache is outside our control.

Similarly, new installs start with no localStorage cache, but the first failed request can get cached at the HTTP level.

## Plan

### 1. Add `skipCache` + cache-busting to retry flows

Modify `cachedCatalogFetch` in `src/lib/catalogCache.ts` to:
- When `skipCache: true` is passed, also use `cache: 'no-store'` on the `fetch()` call to bypass the browser HTTP cache entirely
- Add a `_cb` (cache-bust) query parameter with a timestamp when skipping cache, to defeat any CDN/proxy caching

### 2. Wire retry button to use `skipCache: true`

In `src/pages/shop/ShopHome.tsx`:
- Add a `forceRefresh` parameter to `fetchAccueilFeed` 
- When `forceRefresh` is true, call `cachedCatalogFetch` with `{ skipCache: true }`
- Update the retry button's `onClick` to pass `true`

### 3. Add a `clearAllCatalogCache` utility

In `src/lib/catalogCache.ts`:
- Export a function that clears ALL `afrishop_cache:` prefixed keys from localStorage AND clears the in-memory LRU cache
- Call this on app startup when a network error is detected on the first catalog fetch (automatic recovery)

### 4. Make `bustStaleCache` also clear on fresh installs

In `src/lib/cacheBust.ts`:
- When `BUILD_KEY` is missing from localStorage (fresh install), still clear any stale cache prefixes that might exist from a previous install's data (e.g., restored from Android backup)

This ensures: (a) Retry always bypasses all cache layers, (b) fresh installs start clean, (c) the browser HTTP cache cannot serve stale 404s on retry.

