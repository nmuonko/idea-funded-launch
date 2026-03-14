## Search Parity Fix — Server-Side Broadening (Complete)

### Problem
"iphone 17" shows results on web (client-side broadening via `expandQuery`) but not on mobile (single-pass, no broadening). The `phone_device` intent filter was dropping 19/20 cached results.

### Changes Made

1. **`searchIntentScorer.ts`** — Added minimum result floor (5 items). When intent filtering drops >80% of items, rescues dropped items with penalty scores instead of discarding entirely.

2. **`searchCacheGuard.ts`** — Added cache intent floor guard logging when filtering is too aggressive.

3. **`catalog-search/index.ts`** — Added server-side DB broadening for device queries: when "iphone 17" returns <10 DB items, auto-fetches adjacent models (16, 15, 18) from DB and merges results. Both web and mobile benefit.

### Previous Work
- Edge Function Consolidation (42 functions deleted)
- Payment flow RLS fixes
