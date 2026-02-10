
# Instant Category Tabs + Replace "Rainforest" with "Amazon"

## Problem

1. **Category tabs are slow**: `ShopHome.tsx` uses raw `fetch()` instead of `cachedCatalogFetch`, so every tab click hits the backend, adding latency and wasting credits.
2. **"Rainforest" label visible**: Several frontend components display "Rainforest" instead of "Amazon" in admin panels and product cards.

## Solution

### 1. Use `cachedCatalogFetch` in ShopHome for instant tabs

Replace the manual `fetch()` in `ShopHome.tsx` with `cachedCatalogFetch`. This means:
- First load of any tab fetches from backend and caches in localStorage
- Subsequent taps on the same tab return **instantly** from local cache (no network call)
- Cache TTL respects the `ttlSeconds` returned by the backend, which comes from admin Refresh Settings
- No Rainforest API credits used for cached responses

**File: `src/pages/shop/ShopHome.tsx`**
- Replace lines 85-103 (manual URL building + fetch) with a call to `cachedCatalogFetch('catalog-home', { page, pageSize, client: 'web', category })`
- The cache key automatically includes the category, so each tab has its own cache entry
- Pagination ("Load More") also benefits from caching

### 2. Backend: Return `Cache-Control` header for web responses

**File: `supabase/functions/catalog-home/index.ts`**
- Add `Cache-Control: public, max-age=<ttlSeconds>` header to web JSON responses
- This enables both browser HTTP cache and the client-side `parseTtlFromResponse` to pick up the correct TTL from admin settings

### 3. Replace "Rainforest" with "Amazon" in frontend

**File: `src/components/admin/CircuitBreakerStatus.tsx`** (line 32)
- Change `'Amazon (Rainforest)'` to `'Amazon'`

**File: `src/components/admin/ProviderHealthCards.tsx`** (line 71)
- Change `'Amazon (Rainforest)'` to `'Amazon'`

**File: `src/components/shop/ProductCard.tsx`**
- Already displays "Amazon" to users (the `getProviderDisplayName` function normalizes it)
- No change needed here

**File: `src/pages/shop/ProductDetails.tsx`**
- Internal routing logic only, no user-visible "Rainforest" text
- No change needed

**File: `src/contexts/ShopCartContext.tsx`**
- Internal ID parsing logic only, no user-visible text
- No change needed

## How Caching Works After This

```text
User taps "Gaming" tab
  --> cachedCatalogFetch checks localStorage
      --> HIT?  Return instantly (0ms, no network)
      --> MISS? Fetch from catalog-home backend
               --> Backend checks home_cache (DB)
                   --> Items tagged with _recipeKey="gaming"
                   --> Returns with ttlSeconds from admin settings
               --> Store in localStorage with that TTL
               --> Next tap = instant
```

## Files Modified

- `src/pages/shop/ShopHome.tsx` -- use `cachedCatalogFetch` instead of raw fetch
- `supabase/functions/catalog-home/index.ts` -- add Cache-Control header to web responses
- `src/components/admin/CircuitBreakerStatus.tsx` -- rename "Amazon (Rainforest)" to "Amazon"
- `src/components/admin/ProviderHealthCards.tsx` -- rename "Amazon (Rainforest)" to "Amazon"

## No Regressions

- Mobile app flow is completely unaffected (uses separate detection and cache path)
- Search page continues using its own caching via `cachedCatalogFetch`
- Backend Rainforest API adapter name stays as-is (internal only, not user-facing)
- Admin Rebuild/Publish buttons still work identically
- "Load More" pagination still works, each page is cached separately
