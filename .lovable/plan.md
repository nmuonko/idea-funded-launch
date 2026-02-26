

## Fix: Make DB-First Search Work Dynamically for All Queries with Proper Pagination

### Current State

The token filtering and limit changes from the last edit ARE fully dynamic -- they apply to every search query, not just "iphone 14". However, there are two real problems causing the "loading loading" behavior:

1. **No DB pagination**: The DB fast path returns ALL 500 items on page 0, then on page 1+ runs the exact same query returning the same items (no offset). The frontend deduplicates them, finds 0 new items, but `hasMore: true` keeps triggering infinite load-more attempts.

2. **DB returns up to 500 items but frontend caps at 100 per page**: The backend sends all 500 items at once on page 0, so there's no need for subsequent pages from the DB. The frontend should recognize this and stop paginating.

### Plan

#### 1. Backend: Add DB offset for pagination (`catalog-search/index.ts`)

Pass a `dbOffset` parameter to `searchDbFirst` based on the current page number, so page 1 returns items 501-1000, page 2 returns 1001-1500, etc. This prevents returning duplicate results.

- Calculate `dbOffset = page * limit` (where page comes from the URL param)
- Pass it to `searchDbFirst` which forwards it to `tierASearch`

#### 2. Backend: Set `hasMore` correctly in DB fast path (`catalog-search/index.ts`)

Instead of always returning `hasMore: true`, set it based on whether the DB returned a full page of results:
- `hasMore: dbFinal.length >= limit` -- if DB returned fewer items than requested, there are no more pages

#### 3. Backend: Add offset support to `searchDbFirst.ts`

Accept an optional `offset` parameter and apply `.range(offset, offset + limit - 1)` to the Tier A database query so subsequent pages get different results.

#### 4. Frontend: No changes needed

The frontend already handles `hasMore: false` correctly to stop pagination. The broadening threshold change (30) from the last edit is fine for all queries.

### Files Changed

| File | Change |
|------|--------|
| `supabase/functions/_shared/searchDbFirst.ts` | Add `offset` parameter to `DbFirstParams` and apply it in `tierASearch` |
| `supabase/functions/catalog-search/index.ts` | Pass page-based offset to `searchDbFirst`; fix `hasMore` to be `dbFinal.length >= limit` |

### Expected Outcome

- Any search ("shoes", "samsung tv", "honda civic", "iphone 14") returns 500 cached results instantly on page 0
- Page 1 returns the NEXT batch of results from the DB (offset 500+), not duplicates
- Pagination stops naturally when the DB runs out of matching items
- No more infinite "loading loading" loop

