

# Fix: Search Returns 0 Results for Queries with Model Numbers

## Problem

"google pixel 9" works (returns 20 items), but "google pixel 11" returns 0 items. The core issue is in the DB-first search token strategy and the fallback logic.

**Trace for "google pixel 11":**
1. DB-first: tokens = ["google", "pixel", "11"] (all kept because "11" has length >= 2)
2. Query: `title ILIKE '%google%' AND title ILIKE '%pixel%' AND title ILIKE '%11%'` -- returns only 2 items (below MIN_RESULTS=8)
3. Falls through to live providers, which timeout at 4s
4. Returns 0 items -- the 2 DB results are thrown away

"google pixel 9" works because "9" has length 1 and is filtered out, so tokens become ["google", "pixel"] which matches 160+ items.

## Root Causes

1. **Pure-number tokens narrow results too aggressively**: "11" matches very few product titles but is kept because length >= 2
2. **DB partial results discarded**: When DB returns 2 items (less than MIN_RESULTS=8), those results are thrown away entirely. If providers then fail/timeout, the user gets 0 instead of 2.
3. **No progressive token relaxation**: When strict tokens return too few results, the system should drop the least-useful tokens and retry

## Solution: Two Changes in catalog-search/index.ts

### Change 1: Exclude pure-number tokens from DB search

In the DB-first search block (line 596), change the token filter to also exclude pure-number tokens. Numbers like "9", "11", "12", "pro" as part of model names are too restrictive as individual ILIKE filters. The remaining brand/product tokens ("google", "pixel", "samsung", "galaxy") are distinctive enough.

```
// BEFORE (line 596):
const searchTokens = qNorm.split(/\s+/).filter((t: string) => t.length >= 2);

// AFTER:
const searchTokens = qNorm.split(/\s+/).filter((t: string) => t.length >= 2 && !/^\d+$/.test(t));
```

This means:
- "google pixel 9" -> tokens: ["google", "pixel"] (unchanged, "9" already filtered by length)
- "google pixel 11" -> tokens: ["google", "pixel"] (now "11" is also filtered as pure number)
- "samsung galaxy s24" -> tokens: ["samsung", "galaxy", "s24"] ("s24" kept because not pure number)
- "iphone 15 pro max" -> tokens: ["iphone", "pro", "max"]

### Change 2: Save partial DB results as fallback for provider failure

Currently, if DB returns < 8 results, those results are discarded and the code falls through to providers. If providers then fail or timeout, the response is empty.

After the DB-first block (around line 684), save any partial DB results. Then in the provider timeout/failure handler, return those partial results instead of empty.

Implementation:
- Add a variable `dbFallbackItems` initialized to null before the DB-first block
- If DB returns > 0 but < MIN_RESULTS items, save them to `dbFallbackItems`
- After the provider fetch (around line 830 where the final response is built), if providers returned 0 items AND `dbFallbackItems` has items, use those instead

## Files Modified

| File | Change |
|------|--------|
| `supabase/functions/catalog-search/index.ts` | Line 596: Add pure-number token filter |
| `supabase/functions/catalog-search/index.ts` | Lines 590-690: Save partial DB results as fallback |
| `supabase/functions/catalog-search/index.ts` | Response builder: Use DB fallback when providers return 0 |

## What Does NOT Change

- Homepage (catalog-home) -- not touched
- Cart, checkout, payments -- not touched
- Mobile or web frontend code -- not touched
- Cache TTLs and stale-while-revalidate -- unchanged
- Typo correction (already handled by queryCanonicalizer with Levenshtein fuzzy matching)
- Response JSON shape -- unchanged

## Expected Results

- "google pixel 11" -> returns 20+ results (tokens: ["google", "pixel"] -> 160 DB matches)
- "samsung galaxy s24" -> returns results (tokens: ["samsung", "galaxy", "s24"])
- "iphone 15" -> returns results (tokens: ["iphone"])
- If providers timeout for any query, partial DB results returned instead of empty
- Typos like "samsun galaxi" already corrected by canonicalizer ("samsung galaxy")

