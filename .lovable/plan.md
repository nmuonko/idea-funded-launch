

# Fix: Return More Search Results on Mobile

## Problem
Most searches return only 20-50 items because of several compounding limits in the search pipeline:

1. **Backend hard caps results at 100** (`MAX_LIMIT = 100`) -- even though the web app requests 200, and the DB has hundreds of matching items
2. **DB Fast Path triggers at only 20 items** (`DB_SUFFICIENT_THRESHOLD = 20`) -- returns results immediately without fetching from live providers. While it does return ALL DB items found, the intent scorer then trims them back down using the capped `limit` of 100
3. **Intent scorer uses the capped `limit` (100)** as its cap -- so even when DB Tier A pulls 400+ items, scoring trims to 100
4. **Mobile app is frozen** and reads `categoryPageSize: 100` from backend config -- it can only fetch 100 per page
5. **Fuzzy search (Tier B) caps at 200** -- `Math.min(limit, 200)` when limit is already 100

## Changes

### 1. Increase backend MAX_LIMIT from 100 to 200
**File**: `supabase/functions/catalog-search/index.ts`
- Change `MAX_LIMIT = 100` to `MAX_LIMIT = 200`
- Change `DEFAULT_LIMIT = 100` to `DEFAULT_LIMIT = 200`
- This allows the web frontend's `PAGE_SIZE = 200` to actually work end-to-end

### 2. Increase DB_SUFFICIENT_THRESHOLD from 20 to 50
**File**: `supabase/functions/catalog-search/index.ts`
- Change `DB_SUFFICIENT_THRESHOLD = 20` to `DB_SUFFICIENT_THRESHOLD = 50`
- Currently, if DB has only 20 items, it skips live providers. With 50, it will also try eBay/Amazon for broader results on sparser queries

### 3. Pass full DB count (not capped limit) to intent scorer for DB fast-path
**File**: `supabase/functions/catalog-search/index.ts`
- In the DB-first scoring block (~line 835), change `limit` to `Math.max(limit, 400)` so intent scoring keeps more items instead of trimming to 100
- In the DB fast-path block (~line 873), ensure all filtered DB items are returned (already the case, but verify no slicing)

### 4. Increase mobile categoryPageSize from 100 to 200
**File**: `supabase/functions/mobile-public-config/index.ts`
- Change `categoryPageSize: 100` to `categoryPageSize: 200`
- This tells the frozen mobile app to request more items per page

### 5. Increase Tier B fuzzy search cap from 200 to 400
**File**: `supabase/functions/_shared/searchDbFirst.ts`
- Change `Math.min(limit, 200)` to `Math.min(limit, 400)` in the Tier B fuzzy search call
- Allows more fuzzy matches to contribute results

### 6. Increase search_catalog_items_ranked default limit
**Database migration**: Change the RPC's default `p_limit` from 100 to 200 to return more fuzzy results by default

## Expected Impact
- Searches that currently return 20-50 items should return 100-400+ items
- Mobile app will request 200 items per page instead of 100
- DB fast-path still fires quickly but returns significantly more results
- Web infinite scroll will load 200 per page (matching frontend expectation)

## Files to Edit
- `supabase/functions/catalog-search/index.ts` -- MAX_LIMIT, DEFAULT_LIMIT, DB_SUFFICIENT_THRESHOLD, scorer limit
- `supabase/functions/mobile-public-config/index.ts` -- categoryPageSize
- `supabase/functions/_shared/searchDbFirst.ts` -- Tier B cap
- Database migration for `search_catalog_items_ranked` default limit

