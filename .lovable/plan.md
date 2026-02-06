

# Hotfix: Make Mobile Search Fast (cache-first + stale-while-revalidate)

## Problem

The current `catalog-search` edge function has:
- **Short cache TTLs**: 10 min stale / 30 min expire -- causes constant live provider fetches
- **No stale-serve**: When cache is stale, it falls through to a full live fetch (lines 476-480 just log "will refresh" then do the slow path)
- **No env fallback**: Staging requests never check production cache, so mobile users always get cold cache misses
- **No hard timeout**: Provider calls (Rainforest/eBay) can take 10s+ with no abort

## Solution (3 changes, all in existing files)

### 1. Increase Search Cache TTL (catalogCache.ts)

Change the search TTL constants from 10min/30min to 24h/7d:

```
// Before
search: { stale: 10, expire: 30 },

// After  
search: { stale: 1440, expire: 10080 },  // 24h stale, 7 days expire
```

This is in `supabase/functions/_shared/catalogCache.ts` line 20.

### 2. Return Stale Immediately + Background Refresh (catalog-search/index.ts)

Currently at line 476-480, when cache is stale it just logs and falls through to the slow provider path. Change this to:

- If stale cache exists: return it immediately with `meta.source="stale"`, `meta.isStale=true`
- Fire a background refresh using `EdgeRuntime.waitUntil()` or detached promise (no await)
- The background refresh writes fresh data to cache for the next request

This is inserted right after line 480 (the stale detection block), before the provider fetch code.

### 3. Add Environment Fallback for Search Cache (catalog-search/index.ts)

After the cache check at line 358, if cache misses and `env !== "production"`, try reading cache with a production-equivalent key. Same pattern already used in catalog-home.

### 4. Add Hard 4s Timeout on Provider Calls (catalog-search/index.ts)

Wrap the `Promise.allSettled([fetchAmazonItems, fetchEbayItems])` at line 502 with `Promise.race` against a 4-second timeout. If timeout fires and stale cache exists, return stale. If no stale cache, return empty.

### 5. Add Response Meta (catalog-search/index.ts)

Add a `meta` field to all responses with: `source`, `isStale`, `envUsed`, `envRequested`, `correlationId`, `ts`. This does not change existing fields -- it is additive only.

## Files Modified

| File | Change |
|------|--------|
| `supabase/functions/_shared/catalogCache.ts` | Line 20: TTL 10/30 to 1440/10080 |
| `supabase/functions/catalog-search/index.ts` | Lines 402-480: stale-serve-immediately logic |
| `supabase/functions/catalog-search/index.ts` | Lines 358-360: env fallback cache read |
| `supabase/functions/catalog-search/index.ts` | Lines 500-530: 4s hard timeout wrapper |
| `supabase/functions/catalog-search/index.ts` | Lines 763-778: add meta field to response |

No new tables needed -- uses existing `catalog_cache` table.

## What Does NOT Change

- Homepage (catalog-home) -- not touched
- Cart, checkout, payments -- not touched
- Mobile or web frontend code -- not touched
- Response JSON shape -- existing fields remain identical; `meta` is additive
- `hasMore`, `nextCursor`, `items`, `providerStats` -- all unchanged

## Technical Details

### Stale-Serve Logic (core change)

```text
// After cache check (line ~477):
if (isStaleCache && cacheResult.data) {
  // Return stale data INSTANTLY
  const staleResponse = { ...cacheResult.data, meta: { source: "stale", isStale: true, ... } };
  
  // Fire background refresh (detached, no await)
  (async () => {
    try {
      // ... full provider fetch + cache write ...
    } catch (e) {
      console.warn("[CATALOG_SEARCH] background refresh failed:", e);
    }
  })();
  
  return new Response(JSON.stringify(staleResponse), { status: 200, ... });
}
```

### Environment Fallback

```text
// After initial cache miss (line ~358):
if (!cacheResult.hit && envName !== "production") {
  const prodCacheKey = globalCacheKey.replace(`env=${envName}`, "env=production");
  // (actually rebuild key with env=production since env is embedded in buildCacheKey)
  cacheResult = await getCache(supabase, prodCacheKey);
  if (cacheResult.hit) {
    console.log(`[CATALOG_SEARCH] env_fallback staging->production`);
  }
}
```

### Hard Timeout

```text
const PROVIDER_TIMEOUT_MS = 4000;

const providerPromise = Promise.allSettled([fetchAmazon, fetchEbay]);
const timeoutPromise = new Promise((_, reject) => 
  setTimeout(() => reject(new Error("PROVIDER_TIMEOUT")), PROVIDER_TIMEOUT_MS)
);

try {
  [amazonSettled, ebaySettled] = await Promise.race([providerPromise, timeoutPromise]);
} catch (e) {
  if (isStaleCache) return stale response;
  // else return empty
}
```

## Deployment

- Redeploy `catalog-search` only
- No database migration needed
- No admin UI changes

## Validation

- First search: `source=live`, cache written with 24h TTL
- Second identical search: `source=cache`, response in under 100ms
- After 24h: `source=stale`, instant response, background refresh triggered
- Staging with empty cache but warm production: `source=cache`, `envUsed=production`

