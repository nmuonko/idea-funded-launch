

## Problem

The initial home feed load (line 1057 in `ShopHome.tsx`) calls `cachedCatalogFetch` without `skipCache: true`. This means:
- **New installs**: The very first request uses `cache: 'default'`, so if a CDN or proxy cached a 404, it gets served
- **Retry button**: Already fixed — uses `forceRefresh = true` with `skipCache`
- **Regular returns**: Uses cached data, which is fine when the cache contains valid data

The `bustStaleCache()` clears localStorage but does NOT clear the browser's HTTP cache.

## Fix

### 1. Force skip HTTP cache on the initial load too

In `ShopHome.tsx` line ~1057, pass `skipCache: true` on the initial `cachedCatalogFetch` call for `catalog-home`. This ensures the very first request on a new install bypasses any stale HTTP-cached 404.

```typescript
const data = await cachedCatalogFetch<HomeFeedResponse>('catalog-home', {
  page: 1,
  pageSize: 100,
  client: 'web',
}, { skipCache: true });
```

This is safe because:
- The localStorage cache is still checked first (instant display of previously cached data)
- `skipCache` only affects the `fetch()` call's `cache` header and adds a `_cb` timestamp param
- The response is still cached in localStorage for subsequent visits
- The cost is negligible — one uncached network request on app open

### 2. Also skip HTTP cache on language-change re-fetch (line 1103)

```typescript
fetchAccueilFeed(true);
```

This ensures language switches also get fresh data.

Both changes are single-line edits in `src/pages/shop/ShopHome.tsx`.

