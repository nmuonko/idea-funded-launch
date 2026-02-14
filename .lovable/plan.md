
# Fix: Search Speed — Timing Instrumentation + Fast Path + Hard Time Budget

## Problem Analysis

Current cache-miss search flow is sequential and unbounded:

1. Category resolution (~50ms)
2. Rate limit check (~50ms)
3. Rewrite + Settings in parallel (~100-500ms)
4. FR-EN fallback (~1ms)
5. **AI refiner await** (~800-2000ms) -- BLOCKING, waits for full result before providers start
6. DB-first search (~200-500ms)
7. Provider fetch (Amazon + eBay parallel, 3-8s)
8. **Alt queries** (up to 3s EACH, sequential loop)
9. **Secondary canonical query** (another 3s)
10. **Tractor fallback** (another 3s)
11. Mix + filter + score + guardrails (~50ms)
12. Media enrichment (~50ms with skipPrefetch)
13. Cache write (~50ms)

Worst case: steps 5+6+7+8+9+10 = 2s + 0.5s + 5s + 3s + 3s + 3s = **16.5s**

## Root Causes

1. **AI refiner blocks providers** (line 499): `await aiRefinePromise` completes before providers start. The refiner modifies `qNorm` which becomes `providerQuery`, so providers can't start until refiner finishes.
2. **Unlimited sequential alt queries** (lines 699-766): If primary returns < 60 items, code tries alt queries AND secondary canonical query, each with 3s timeouts.
3. **No global time budget**: Nothing stops the function from spending 16s on sequential fallbacks.
4. **Cache write happens LAST** (line 1060): Even if primary results are good, cache isn't populated until all fallback attempts complete.

## Changes

### 1. Timing Instrumentation (File: `catalog-search/index.ts`)

Add a `timings` object that tracks each stage:

```text
timings = {
  rewrite: 0,    // rewrite + settings parallel
  aiRefine: 0,   // AI refiner wait
  dbFirst: 0,    // DB-first search
  providers: 0,  // primary provider fetch
  altQueries: 0, // alt + secondary attempts
  postProcess: 0,// filter + score + guardrails + media
  total: 0
}
```

Return these as response headers:
- `X-Search-T-Total`, `X-Search-T-Rewrite`, `X-Search-T-Db`, `X-Search-T-Upstream`, `X-Search-T-AltQueries`, `X-Search-T-PostProcess`
- Existing `X-Cache-Status` (HIT/STALE/MISS) already works

Log a single structured timing line per request.

### 2. Fast Path for Direct Queries (File: `catalog-search/index.ts`)

Add `isDirectQuery(q)` function:
- Query has <= 6 words
- Contains at least one digit OR a known model token (iphone, samsung, tecno, infinix, pixel, playstation, ps5, xbox, macbook, thinkpad, galaxy, redmi, oppo, vivo, huawei, camon, spark, hot, note)
- NOT a single broad generic term (telephone, tv, frigo, vetement, chaussure, ordinateur, voiture, cuisiniere alone without specifics)

When `isDirectQuery` is true:
- **Do NOT await AI refiner** -- use the FR-EN fallback rewrite or original query directly for providers
- Fire AI refiner in parallel (non-blocking) -- if it returns before providers, use its result; otherwise ignore
- Skip DB-first search entirely (direct queries hit providers immediately)
- After primary providers return: skip ALL alt query attempts regardless of result count

This ensures queries like "tecno camon 20", "iphone 13", "cuisiniere 4 feux" go straight to providers.

### 3. Hard Time Budget + Limited Retries (File: `catalog-search/index.ts`)

Constants:
```typescript
const TOTAL_BUDGET_MS = 3500;
const REWRITE_BUDGET_MS = 800;
const AI_REFINE_BUDGET_MS = 800; // reduced from 2000
const DB_BUDGET_MS = 500;
const ALT_QUERIES_MAX = 1; // down from unlimited
```

Implementation:
- Wrap rewrite+settings `Promise.all` with `Promise.race` against `REWRITE_BUDGET_MS` timeout
- Wrap AI refiner with `AI_REFINE_BUDGET_MS` timeout (reduce from 2s to 800ms)
- Wrap DB-first with `DB_BUDGET_MS` timeout
- Before alt queries: check `Date.now() - startTime > TOTAL_BUDGET_MS` -- if exceeded, skip entirely
- Limit alt query loop to `ALT_QUERIES_MAX = 1` attempt (currently unlimited)
- Remove secondary canonical query attempt entirely (lines 736-765) -- it's redundant with alt queries
- Remove tractor-specific 3rd attempt (lines 768-797) -- fold into alt query logic

### 4. Early Cache Population (File: `catalog-search/index.ts`)

After primary provider results are mixed and filtered (before alt queries):
- If result count > 0, immediately write to shared cache with a "partial" flag
- This means the NEXT user gets instant results even if we're still running alt queries
- On final response, overwrite cache with complete results (removes partial flag)

### 5. Confirm Media Enrichment Not Blocking

Already confirmed: `enrichItemsWithMediaCounts` is called with `{ skipPrefetch: true }` (line 833). With skipPrefetch, it only does DB lookups for cached counts -- no HTTP fetches, no 3s timeouts. This is fine (~50ms).

## File Changes

| File | Change |
|------|--------|
| `supabase/functions/catalog-search/index.ts` | Add timings object, `isDirectQuery()`, time budgets, early cache write, remove redundant fallbacks, add timing headers |
| `supabase/functions/_shared/searchAiExpand.ts` | Reduce `AI_REFINE_TIMEOUT_MS` from 2000 to 800 |
| `supabase/functions/_shared/searchResponseBuilder.ts` | Add timing headers to `buildResponseHeaders` |

## Expected Flow After Changes

### Fast Path ("tecno camon 20"):
```text
1. Category + Rate limit + Rewrite+Settings (parallel) ~200ms
2. FR-EN fallback (instant) ~1ms  
3. Skip AI refiner await, skip DB-first
4. Provider fetch (Amazon + eBay parallel) ~2-4s
5. Mix + filter + score ~50ms
6. Early cache write (fire-and-forget)
7. Return response
TOTAL: ~2.5-4.5s (down from 10-18s)
```

### Normal Path ("chaussures homme"):
```text
1. Category + Rate limit + Rewrite+Settings ~200ms
2. AI refiner (800ms budget, timeout = continue without)
3. DB-first (500ms budget)
4. Provider fetch ~2-4s
5. Check budget: if > 3.5s elapsed, skip alt queries
6. At most 1 alt query attempt
7. Mix + filter + score ~50ms
8. Cache write
9. Return response  
TOTAL: ~3-5s max
```

## What Is NOT Changed

- No payment, checkout, or category logic changes
- Cache key format unchanged (existing cached results still valid)
- Provider fetcher internals unchanged
- Content blocking, scoring, guardrails unchanged
- Client-side LRU + SWR unchanged
