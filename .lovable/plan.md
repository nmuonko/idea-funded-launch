

## Speed Up Search Results from Cached Products

### Problem
When searching "iphone 14", only 79 results are returned initially, and loading more takes a very long time because the system falls back to slow live provider APIs (Amazon/eBay) instead of using the 75,000+ cached products in the database.

### Root Causes

1. **Model numbers dropped from search**: The database search drops pure-number tokens like "14" from "iphone 14", so it searches only for "iphone" -- returning all iPhone models instead of specifically iPhone 14. This reduces both quantity and relevance.

2. **Database fetch limit too low**: Tier A only fetches 200 items maximum from the cached catalog, even though there may be thousands of matching products.

3. **DB fast path says "no more results"**: When the database returns enough results to skip live providers, it tells the frontend there are no more results (`hasMore: false`). This causes the frontend to attempt slow background broadening or revalidation calls.

4. **Subsequent pages always hit live providers**: Pages after page 0 bypass the DB fast path and call Amazon/eBay APIs with 5-8 second timeouts, even though the database already has plenty of cached results.

### Plan

#### 1. Keep numeric tokens in DB search (`searchDbFirst.ts`)

Stop filtering out pure-digit tokens so "iphone 14" searches for BOTH "iphone" AND "14" in titles. This dramatically improves relevance and returns more specific results.

Short digits (1 character) will still be filtered to avoid noise.

#### 2. Increase Tier A fetch limit (`searchDbFirst.ts`)

Increase from 200 to 500 items per Tier A query to pull more results from the 75K+ cached catalog on the first hit.

#### 3. Fix DB fast path pagination (`catalog-search/index.ts`)

When DB fast path triggers (50+ results from database), set `hasMore: true` so the frontend knows it can request more pages. This prevents unnecessary broadening attempts.

#### 4. Enable DB-first on all pages (`catalog-search/index.ts`)

Currently DB-first only runs when there's no cursor (`if (!cursor)`). Change this so pages > 0 also query the database first. If DB returns enough results, skip the slow live provider calls entirely.

#### 5. Frontend: increase broadening threshold (`SearchResults.tsx`)

Since we're now returning more DB results, raise `BROADEN_THRESHOLD` from 50 to 30 (i.e., only broaden if we get fewer than 30 results -- a truly sparse result). This prevents unnecessary background fetches when DB already provided 79+ items.

### Files Changed

| File | Change |
|------|--------|
| `supabase/functions/_shared/searchDbFirst.ts` | Keep numeric tokens (>=2 chars), increase Tier A limit to 500 |
| `supabase/functions/catalog-search/index.ts` | DB fast path returns `hasMore: true`; enable DB-first search on all pages (not just page 0) |
| `src/pages/shop/SearchResults.tsx` | Lower `BROADEN_THRESHOLD` to 30 to avoid unnecessary background fetches |

### Expected Outcome
- "iphone 14" returns 200+ relevant results instantly from cached products
- No slow "loading loading loading" -- subsequent pages also served from DB in milliseconds
- Results are more relevant (specific to iPhone 14, not all iPhones)

