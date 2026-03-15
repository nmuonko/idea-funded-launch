## Unified Search Pipeline — Web + Mobile Parity (Complete)

### Problem
Web app showed ~500 products for searches like "iphone 17" while mobile showed only ~5. The web used client-side broadening (`expandQuery`) making multiple extra API calls; mobile had no broadening at all.

### Root Cause
Two separate search pipelines:
- **Web**: server call + client-side broadening (expandQuery → multiple catalog-search calls → merge/dedup) → ~500+ items
- **Mobile**: single server call with aggressive intent filtering → ~5 items

### Changes Made

1. **`catalog-search/index.ts`** — Made server-side broadening **fully dynamic for all queries**:
   - `MIN_TARGET_RESULTS` raised from 200 → 500 (matches web's PAGE_SIZE)
   - `BROADEN_THRESHOLD` raised from 60 → 200 (triggers broadening more aggressively)
   - `BROADEN_TARGET` raised from 200 → 500
   - `SPARSE_ENRICHMENT_TARGET` raised to 500
   - DB broadening now runs for ALL queries (not just device-intent): uses `generateBroadenedQueries` for year/qualifier stripping + progressive shortening
   - Device-intent broadening (adjacent models) still runs for phone queries
   - Cache sparse bypass for device-intent queries with < 10 cached items

2. **`SearchResults.tsx`** — **Removed client-side broadening entirely**:
   - Removed `expandQuery`/`relevanceScore` imports
   - Removed `runBroadening` function and `isBroadening` state
   - Removed `BROADEN_THRESHOLD`/`BROADEN_TARGET` constants
   - Both web and mobile now get identical results from a single `catalog-search` call

3. **`searchIntentScorer.ts`** — MIN_RESULT_FLOOR of 5 prevents over-filtering

4. **`searchCacheGuard.ts`** — Floor guard keeps minimum 5 items when filtering is too aggressive

### Result
Both web and mobile hit the exact same `catalog-search` endpoint, get the same broadening, same scoring, same result count. No more client-side divergence.

### Previous Work
- Edge Function Consolidation (42 functions deleted)
- Payment flow RLS fixes
