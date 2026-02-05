
# Fix: $0.00 Pricing Regression - Cache Version Bump

## Problem Diagnosis

After extensive investigation, the issue has been identified:

1. **Backend is working correctly** - The `catalog-home` endpoint returns valid prices (confirmed via API test: `priceUsd: 154.95, 189.99, 159.95, etc.`)

2. **Fresh browser shows correct prices** - Opening a new browser session displays prices correctly (verified with browser tool screenshot)

3. **Your browser has stale cached data** - The frontend uses localStorage to cache catalog responses for 1 hour (3600 seconds). Your browser is serving old cached data from BEFORE the price extraction was fixed.

## Root Cause

```
src/lib/catalogCache.ts (line 6):
const CACHE_PREFIX = 'afrishop_cache:v2:';
```

Your browser's localStorage contains `afrishop_cache:v2:catalog-home:...` with old data where `priceUsd: 0`. The cache hasn't expired yet, so the frontend serves this stale response instead of fetching fresh data.

## Solution

**Increment the cache version from `v2` → `v3`** in the frontend cache module. This will:

- Force ALL browsers to ignore old cached data (cache key changes from `afrishop_cache:v2:` to `afrishop_cache:v3:`)
- Immediately fetch fresh catalog data with correct prices
- No backend changes needed

---

## Technical Changes

### File: `src/lib/catalogCache.ts`

**Change line 6:**
```typescript
// Before
const CACHE_PREFIX = 'afrishop_cache:v2:';

// After
const CACHE_PREFIX = 'afrishop_cache:v3:';
```

This single-line change will:
1. Invalidate all existing cached catalog data across all user browsers
2. Cause the next page load to fetch fresh data from the backend
3. Display correct prices ($154.95, $189.99, etc.) immediately

---

## Verification Plan

After the change:
1. Reload the homepage
2. Verify prices display correctly (e.g., $154.95, $189.99)
3. Check console logs show `[CACHE] STORE key= afrishop_cache:v3:...` (new version)
