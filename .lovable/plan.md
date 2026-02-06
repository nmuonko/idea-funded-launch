

# Fix: Empty Search Results Cached for Hours in Browser

## Problem

The screenshot shows "google pixel 9" returning "No products found" on the production website. However, the backend endpoint returns 20+ results correctly. The issue is a **browser/CDN cache poisoning** problem.

**Root cause chain:**
1. At some point before the recent fixes, "google pixel 9" returned 0 results from the backend
2. The backend response included `Cache-Control: public, max-age=3600` (1 hour) even for that empty response
3. The client-side `catalogCache.ts` (localStorage cache) stored the empty response with that 1-hour TTL
4. The browser HTTP cache also stored it
5. Now the backend is fixed and returns results, but the user's browser keeps serving the cached empty response

**Why the server-side guards don't help:**
- Guard A/B only protect the Supabase `catalog_cache` table (server-side DB cache)
- They do NOT affect the `Cache-Control` HTTP header sent to the browser
- Line 1129 sends `Cache-Control: public, max-age=3600` for ALL responses, including 0-item responses
- The client's `catalogCache.ts` reads this header and caches the empty payload for 3600 seconds in localStorage

## Solution: 3 Backend-Only Changes in catalog-search/index.ts

### Change 1: Cache-Control header must reflect content (line 1123-1131)

When building the final response, set `Cache-Control` based on whether there are results:

- If `finalItems.length > 0`: Keep current `Cache-Control: public, max-age=3600, s-maxage=...`
- If `finalItems.length === 0`: Use `Cache-Control: no-store, max-age=0` so browsers and CDNs do NOT cache the empty response

This is the critical fix. The client-side `catalogCache.ts` calls `parseTtlFromResponse()` which reads `max-age` from the Cache-Control header. If `max-age=0`, it will store with 0 TTL and the next request will be a cache miss.

### Change 2: DB-first response also needs proper Cache-Control (line 695-698)

The DB-first early return (when DB has >= 8 results) currently sends no Cache-Control header at all. Add `Cache-Control: public, max-age=3600` so the client caches these positive results properly.

### Change 3: DB fallback response needs proper Cache-Control (line 1053-1062)

The `dbFallbackItems` response also sends no Cache-Control. Add `Cache-Control: public, max-age=1800` (30 min, shorter since it's partial results that should be refreshed sooner).

### Change 4: Add ttlSeconds=0 to empty response body as safety net

The client's `parseTtlFromResponse` also checks `data.ttlSeconds` as a fallback. Set `ttlSeconds: 0` in the response body when items are empty, so even if Cache-Control parsing fails, the client won't long-cache.

## Files Modified

| File | Lines | Change |
|------|-------|--------|
| `supabase/functions/catalog-search/index.ts` | ~1123-1131 | Set `Cache-Control: no-store, max-age=0` when `finalItems.length === 0` |
| `supabase/functions/catalog-search/index.ts` | ~695-698 | Add `Cache-Control: public, max-age=3600` to DB-first response |
| `supabase/functions/catalog-search/index.ts` | ~1053-1062 | Add `Cache-Control: public, max-age=1800` to DB fallback response |
| `supabase/functions/catalog-search/index.ts` | ~1065 (response object) | Set `ttlSeconds: 0` when items.length === 0 |

## What Does NOT Change

- Frontend code (no changes to catalogCache.ts or SearchResults.tsx)
- Homepage endpoints (catalog-home / catalog-home-v2)
- Cart, checkout, payments
- Response JSON shape (same keys, same structure)
- Server-side cache guards (Guard A/B remain intact)
- Existing positive caching behavior (unchanged for non-empty results)

## Expected Results After Fix

- "google pixel 9" works immediately for new users (no poisoned cache)
- Existing users with poisoned localStorage cache: their cached entry expires naturally (within the remaining TTL, up to 1 hour max), then the next request gets fresh results with proper headers
- Future empty results: browser receives `max-age=0` so they are never cached long-term
- Positive results: still cached for 1 hour client-side (unchanged behavior)

