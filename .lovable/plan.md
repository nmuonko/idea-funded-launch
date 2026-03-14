

# Search Parity: Web vs Mobile App

## Problem

When searching "iphone 17" on the **web app**, results appear. On the **mobile app**, they don't. The user correctly identified that the search flows differ.

## Root Cause

The web and mobile search pipelines are **architecturally different** despite both ultimately calling `catalog-search`:

### Web Flow (rich, multi-pass)
1. Calls `catalog-search` for primary results
2. Runs **client-side broadening** (`expandQuery` in `SearchResults.tsx`): generates similar queries like "iphone 16", "iphone 15", "iphone" and fetches those results too
3. Merges and deduplicates all results, scoring by relevance
4. Result: Even when "iphone 17" has only 1 exact match (it's an unreleased phone), the web shows dozens of related iPhones

### Mobile Flow (single-pass, no broadening)
1. Calls `market-search-proxy` (or `catalog-search` directly)
2. Gets raw results — for "iphone 17", the `phone_device` intent filter aggressively drops 19 of 20 cached items (accessories, cases) leaving just **1 result**
3. No broadening step exists on mobile
4. Result: Mobile shows essentially nothing

**Evidence from logs:**
```
cache_intent_filter(phone_device): 20 → 1 (dropped=19)
```

### Secondary Issue: `market-search-proxy` is never called
The edge function logs show **zero** hits for `market-search-proxy`, meaning the mobile app is either:
- Hitting `catalog-search` directly (confirmed by env resolver log: "Mobile request sent ?env=staging")
- Or hitting through the `catalog` proxy router

This means the mobile search has no broadening layer at all.

## Proposed Fix

### Approach: Add server-side broadening to `catalog-search`

Rather than adding broadening logic to the mobile proxy (which would require a mobile app update), add an optional broadening pass directly in `catalog-search` when results are too few. This fixes both web and mobile simultaneously.

### Changes

**1. Add broadening logic to `catalog-search/index.ts`**
- After the primary search returns results, check if the count is below a threshold (e.g., < 10 items for `phone_device` intent)
- If so, generate broadened queries using the same logic as `expandQuery` (nearby model numbers, stripped qualifiers)
- Execute 1-2 additional DB queries with the broadened terms
- Merge, deduplicate, and re-score the combined results
- This runs server-side so both web and mobile benefit

**2. Add device-family broadening in `searchIntentScorer.ts`**
- For iPhone queries with a specific model number (e.g., "17"), when few exact matches exist, automatically include adjacent model numbers (16, 15, etc.) as fallback results with lower scores
- This mirrors what the web's `expandQuery` does with "nearby years"

**3. Relax the `phone_device` intent filter for unreleased/rare models**
- When the intent filter drops >80% of results, keep some lower-scored items instead of hard-dropping all of them
- Add a minimum floor (e.g., keep at least 5 items) to prevent empty results

### Files to Change

| File | Change |
|------|--------|
| `supabase/functions/catalog-search/index.ts` | Add server-side broadening when result count < threshold |
| `supabase/functions/_shared/searchIntentScorer.ts` | Add minimum result floor; relax hard-drops when too aggressive |
| `supabase/functions/_shared/searchCacheGuard.ts` | Pass through minimum result count to prevent over-filtering |

