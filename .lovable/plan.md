

## Problem

The mobile app (frozen .aab build) calls `catalog-home` directly via native HTTP (OkHttp on Android). The mobile responses from `serveMobileSections` in `mobileSectionsCache.ts` are returned **without any `Cache-Control` header**. This means:

1. During the migration, the old 404 error response had no cache directives
2. Android's OkHttp/system HTTP cache applied **heuristic caching** (can cache for hours or days)
3. The cached 404 is being served from the device's native HTTP cache on every request
4. The user cannot clear this — uninstalling and reinstalling may not clear the HTTP cache on some Android versions

The web frontend fixes (skipCache, no-store) are irrelevant here because the **mobile app uses its own native fetch**, not the web's `catalogCache.ts`.

## Fix (Backend-Only — No Mobile Rebuild Needed)

### 1. Add `Cache-Control` and `Vary` headers to ALL mobile responses in `mobileSectionsCache.ts`

Every `new Response(...)` in `serveMobileSections` and `emptyMobileSectionsResponse` (4 response sites) currently has:
```
headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" }
```

Change to:
```
headers: {
  ...corsHeaders,
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store, no-cache, must-revalidate",
  "Pragma": "no-cache",
}
```

This forces OkHttp to **never use a cached response** — every request hits the server. This is safe because:
- The edge function has its own server-side cache (mobile_sections_cache table) so responses are fast (~100-200ms)
- Mobile data usage is negligible (single JSON response)

### 2. Also add same headers to the `jsonResponse` helper in `catalog-home/index.ts`

Update the `jsonResponse` function to add `no-store` for ALL responses (not just errors), ensuring no HTTP-level caching occurs at any layer. The `max-age=300` currently set for successful responses is what allows OkHttp to cache them.

Specifically, change the cache logic (lines 220-232) to always set `no-store` for mobile requests. Since `jsonResponse` doesn't know the client type, we'll add an optional parameter.

### 3. Redeploy `catalog-home`

After the code changes, redeploy the edge function. The next time any mobile user opens the app, OkHttp will see `no-store` and fetch fresh data from the server, bypassing any cached 404.

### Files to Edit
- `supabase/functions/_shared/mobileSectionsCache.ts` — Add `Cache-Control: no-store` to all 4 response sites
- `supabase/functions/catalog-home/index.ts` — Ensure `jsonResponse` uses `no-store` for mobile client responses

