

# Fix: Catalog Cache Shows "~0 total" Despite 22,473 Items Existing

## Root Cause

Two problems are causing the zero count:

1. **Edge function not deployed** -- The `admin-catalog-items` function is returning a 404, so the summary call fails silently.
2. **Duplicate queries with shared cache key** -- Both `SummaryCards` (line 76) and the main `CatalogCache` component (line 1046) use the query key `['catalog-cache-summary']`. The `SummaryCards` version runs first **without** the DB fallback, caches the failed/empty result, and the main component's version (which has the fallback) never actually executes because React Query reuses the cached result.

## Fix

### 1. Consolidate into one query with DB fallback (in `SummaryCards`)

Move the robust fetcher (with DB fallback) into `SummaryCards` since it runs first, and have it export the `total_count` for the footer. Remove the duplicate query from the main `CatalogCache` component entirely.

### 2. Redeploy the edge function

Deploy `admin-catalog-items` so the primary path works again.

### 3. Pass total count from SummaryCards to parent

`SummaryCards` already fetches summary data. It will expose `total_count` via an `onTotalCount` callback prop so the `ItemsTable` footer can display it.

## Technical Details

### File: `src/pages/admin/CatalogCache.tsx`

**SummaryCards** (line 74-116):
- Update the `queryFn` to include the DB fallback (same pattern already written at line 1048-1059)
- Add an `onTotalCount` callback prop that fires when data loads
- Call `onTotalCount(total_count)` inside a `useEffect`

**CatalogCache** (line 1042-1086):
- Remove the duplicate `useQuery` for `['catalog-cache-summary']` (lines 1046-1062)
- Add a `useState` for `totalCount` and pass its setter to `SummaryCards` via `onTotalCount`
- Pass `totalCount` state to `ItemsTable` (same as now)

### Edge function deployment
- Redeploy `admin-catalog-items` to fix the 404

