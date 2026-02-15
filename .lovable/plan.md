

# Backend Performance Optimization Plan

## Overview

After reviewing all critical edge functions and shared modules, I identified 7 performance improvements. These target the three hottest paths: search, product detail, and homepage -- the endpoints that handle 95%+ of user traffic.

---

## Issue 1: `getCatalogSettings()` Hits DB on Every Single Request

**File**: `supabase/functions/_shared/catalogSettings.ts`
**Impact**: HIGH -- every search, category, and home request triggers a full DB query for ~20 admin_settings rows.

**Problem**: The function comment says "Always fetches fresh each request to ensure instant admin updates." But admin settings change maybe once per day. Meanwhile, `settings-cache.ts` and `settingsMemoryCache.ts` both implement proper in-memory TTL caching (60s) for the `settings` table -- but `catalogSettings.ts` does not use either.

**Fix**: Add a 60-second in-memory TTL cache to `getCatalogSettings()`, matching the pattern in `settingsMemoryCache.ts`. Admin updates are reflected within 60 seconds -- acceptable for config changes.

```text
Before: Every search = 1 DB query for 20 rows
After:  1 DB query per 60 seconds (shared across all requests in the same edge function instance)
```

**Changes**:
- Add `let catalogSettingsCache: { value: CatalogSettings; expiresAt: number } | null = null` at module level
- Return cached value if `Date.now() < expiresAt`
- Otherwise fetch fresh and update cache
- Add `invalidateCatalogSettingsCache()` export for admin update endpoints

---

## Issue 2: Category Resolution is Sequential (Blocks Everything)

**File**: `supabase/functions/catalog-search/index.ts` (lines 117-128)
**Impact**: MEDIUM -- adds 50-150ms latency before any other work begins.

**Problem**: `resolveCategoryWithDb()` runs as the very first await, blocking rate limiting, settings fetch, and query rewriting from starting. These have no data dependency on the category result.

**Fix**: Move category resolution into the existing parallel block with rewrite + settings (lines 216-228). The category result is only needed later when building the cache key and provider queries.

```text
Before: category (100ms) -> [rewrite + settings] (200ms) -> rest
After:  [category + rewrite + settings] (200ms) -> rest
Savings: ~100ms per request with category_key
```

**Changes**:
- Wrap `resolveCategoryWithDb` into `Promise.all` alongside `rewriteSearchQuery` and `getCatalogSettings`
- Move category resolution variables after the parallel block

---

## Issue 3: Double Cache Write for Same Key

**File**: `supabase/functions/catalog-search/index.ts` (lines 1165-1170 and 1337-1340)
**Impact**: MEDIUM -- every cache-miss search writes the same key twice to the DB.

**Problem**: An "early cache write" fires at line 1165 (before final response assembly), then a "final cache write" fires at line 1337 with identical data + minor metadata differences. Both are fire-and-forget upserts to `catalog_cache`. This doubles write pressure on the cache table for zero benefit.

**Fix**: Remove the early cache write (lines 1157-1171). The final cache write at line 1337 already includes all data. The time difference between the two writes is <50ms (just response assembly).

---

## Issue 4: Near-Match LIKE Query is Index-Unfriendly

**File**: `supabase/functions/_shared/searchCacheSimilarity.ts` (lines 130-140)
**Impact**: MEDIUM -- `LIKE '%pattern%'` queries cannot use B-tree indexes, causing sequential scans on the `catalog_cache` table.

**Problem**: The near-match lookup uses `.like("cache_key", keyPattern)` where `keyPattern` is `search:%:p=all:%:vm=0:%:in=general:%`. This pattern has wildcards on both sides, so PostgreSQL must scan all rows. As the cache table grows (thousands of entries), this gets slower.

**Fix**: Add a dedicated `query_fingerprint` column to `catalog_cache` and use equality matching instead of LIKE. Store the sorted token fingerprint (already computed by `buildFingerprint()`) when writing cache. On near-match lookup, query by `cache_type = 'search'` + exact equality filters for `provider`, `vehicleMode`, `intentKey`, then compute Jaccard similarity only on the filtered set.

**Alternative (simpler, no schema change)**: Add a composite index on `catalog_cache(cache_type, query)` and filter by `cache_type = 'search'` + `gt("expires_at", now)` first. Then iterate candidates in-memory. This is already partially done but the LIKE on `cache_key` defeats the index.

**Recommended approach**: Use the simpler alternative -- remove the `.like("cache_key", keyPattern)` filter and rely on `cache_type = 'search'` + `expires_at` + limit 50. The Jaccard computation already filters irrelevant results. This eliminates the expensive LIKE scan with minimal code change.

---

## Issue 5: Translation Cache Creates Redundant PostgREST Client

**File**: `supabase/functions/_shared/queryTranslator.ts` (lines 49-57)
**Impact**: LOW -- creates a new HTTP client just to increment `hit_count`.

**Problem**: On every translation cache hit, the code creates a brand new `createAdminPostgrestClient()` solely to fire-and-forget a `hit_count` increment. This adds ~5ms of object creation + an unnecessary HTTP connection.

**Fix**: Reuse the existing client from line 31 for the update, or batch the increment using a deferred write pattern (accumulate hits in memory, flush periodically). For simplicity, just reuse the client.

---

## Issue 6: Product Detail Sequential DB Lookups

**File**: `supabase/functions/catalog-product/index.ts` (lines 440-480)
**Impact**: MEDIUM -- catalog_items lookup and variants cache lookup are sequential.

**Problem**: The flow is:
1. Query `catalog_items` by ID (await)
2. If found, query `product_variants_cache` by product_id (await)

These two queries are independent and can run in parallel.

**Fix**: Use `Promise.all` to fetch both simultaneously:
```text
Before: catalog_items (80ms) -> variants_cache (40ms) = 120ms
After:  [catalog_items + variants_cache] = 80ms (max of both)
Savings: ~40ms per product page load
```

---

## Issue 7: Duplicate FR-to-EN Translation Maps

**File**: `supabase/functions/catalog-search/index.ts`
**Impact**: LOW (code quality / bundle size) -- the same French-to-English word map exists in THREE places:
1. `FR_EN_FALLBACK` (lines 239-443) -- ~200 entries, used for query rewriting
2. `FR_FORCE_MAP` (lines 816-833) -- ~40 entries, subset of #1, used for provider query sanitization
3. The static fallback check at lines 474-510 iterates `FR_EN_FALLBACK` again

**Fix**: Extract a single `FR_EN_MAP` into `_shared/frenchEnglishMap.ts`. Import it in catalog-search. Use it for both translation fallback and provider query sanitization. This reduces the bundle size by ~3KB and eliminates the risk of maps diverging.

---

## Summary

| # | Issue | Impact | Risk | Estimated Savings |
|---|-------|--------|------|-------------------|
| 1 | Settings DB query every request | HIGH | Low | ~50ms/request, ~95% fewer DB queries |
| 2 | Sequential category resolution | MEDIUM | Low | ~100ms on category searches |
| 3 | Double cache write | MEDIUM | Low | 50% fewer cache table writes |
| 4 | LIKE query on cache_key | MEDIUM | Low | Faster near-match lookups at scale |
| 5 | Redundant PostgREST client | LOW | Low | ~5ms per translation cache hit |
| 6 | Sequential product DB lookups | MEDIUM | Low | ~40ms per product page |
| 7 | Duplicate FR-EN maps | LOW | Low | ~3KB bundle reduction |

## Implementation Order

1. Issue 1 (settings cache) -- highest ROI, simplest change
2. Issue 3 (remove double cache write) -- one-liner delete
3. Issue 6 (parallel product lookups) -- straightforward Promise.all
4. Issue 2 (parallel category resolution) -- moderate refactor
5. Issue 5 (reuse PostgREST client) -- trivial fix
6. Issue 4 (near-match query optimization) -- remove LIKE filter
7. Issue 7 (extract FR-EN map) -- cleanup / code quality

## Files Changed

| File | Changes |
|------|---------|
| `supabase/functions/_shared/catalogSettings.ts` | Add 60s in-memory TTL cache |
| `supabase/functions/catalog-search/index.ts` | Parallelize category resolution; remove early cache write; use shared FR-EN map |
| `supabase/functions/_shared/searchCacheSimilarity.ts` | Remove LIKE filter, use equality filters only |
| `supabase/functions/_shared/queryTranslator.ts` | Reuse PostgREST client for hit_count |
| `supabase/functions/catalog-product/index.ts` | Parallel catalog_items + variants_cache lookup |
| `supabase/functions/_shared/frenchEnglishMap.ts` | NEW: Single source of truth for FR-EN translation map |

