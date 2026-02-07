

# Fix Gaming Tab: Scorer Too Strict + Cache Bypass

## Problem

Testing the deployed edge function confirms the scorer works but is **too aggressive**: eBay returns 5 items from category 139971, and the scorer drops all 5. This means:

- The Gaming tab shows **zero new results** from the live API
- Users see stale cached results from before the scorer was added (lots, bundles, shoes)
- The cache path (`filterCachedItems`) never applies the scorer or category guard, so old cached items pass through unfiltered

## Root Causes

1. **Scorer model gate too strict**: Items from eBay's "Video Game Consoles" category (139971) may have titles like "Microsoft Xbox 360 Video Game Console" which should match but could fail due to word ordering or the "for X" pattern false-positive
2. **Cache hit path skips scorer**: When cache returns results (lines 442-451), `filterCachedItems` only applies price/brand/vehicle filters -- NOT the gaming scorer or the universal category guard
3. **Search rewriter corrupts query**: The rewriter transforms `"video game console"` to `"video game gaming console playstation xbox"`, and the canonicalizer turns `"game"` into `"gle"` (Mercedes GLE), though the intent classifier catches this correctly

## Changes (3 files)

### 1. `supabase/functions/_shared/searchCacheGuard.ts`
Add gaming/phone/vehicle category guard to `filterCachedItems` so cached results also get filtered:

- Import `scoreAndRankItems` from `searchIntentScorer.ts`
- Accept `intentKey` parameter
- For `gaming`, `phone_device`, `vehicle_listing` intents: apply `scoreAndRankItems` to cached items
- Also apply the `UNIVERSAL_WRONG_CAT_KW` shoe/clothing drop to cached items
- This ensures old cached "Lot of 40" and shoe results are filtered even on cache hit

### 2. `supabase/functions/_shared/searchIntentScorer.ts`
Relax the gaming scorer to allow legitimate console listings from eBay category 139971:

- Add more model signals: `"xbox 360 console"`, `"xbox 360 video game"`, `"video game console"` (standalone as a signal when combined with a brand)
- Relax the "w/ cables" drop -- items like "Xbox 360 Console W/ CABLES" from eBay consoles category are legitimate single-console listings, not bundles. Remove `"w/ cables"` and `"with cables"` from `LOT_BUNDLE_DROP` (they were just added). Instead, keep dropping `"w/ games lot"` and `"with games lot"`
- Ensure "Lot of" + number still drops, but standalone listings mentioning cables are kept
- Add `"video game console"` to `CONSOLE_MODEL_SIGNALS` so eBay items with generic "Video Game Console" in their title can pass when combined with a brand name

### 3. `supabase/functions/catalog-search/index.ts`
Pass `effectiveIntent.intentKey` to all `filterCachedItems` calls (3 places: fresh cache hit, stale cache, and background refresh) so the cache path applies intent-based filtering.

### 4. `supabase/functions/_shared/catalogCache.ts`
Bump `AMAZON_CACHE_VERSION` to `v8` to flush server-side cached results that contain lots/bundles.

## Technical Details

### Why the scorer drops all 5 eBay items

From the API test response:
- `scoring.dropped: 5` -- all items dropped
- eBay category 139971 returns items like "Microsoft Xbox 360 Video Game Console W/ CABLES" which gets dropped by the `"w/ cables"` rule added in the last change
- Or items with condition "Used" which gets dropped by the condition gate (even though conditionIds filter was applied at API level, some items may have ambiguous condition metadata)

### Cache path flow (current vs. fixed)

```text
Current:
  Cache hit -> filterCachedItems (price/vehicle only) -> return (no gaming scorer!)
  
Fixed:
  Cache hit -> filterCachedItems (price/vehicle + intent scorer + category guard) -> return
```

### Files Modified

| File | Change |
|------|--------|
| `supabase/functions/_shared/searchCacheGuard.ts` | Add intent-based scoring to cached items |
| `supabase/functions/_shared/searchIntentScorer.ts` | Relax "w/ cables" rule, add more model signals |
| `supabase/functions/catalog-search/index.ts` | Pass intentKey to filterCachedItems |
| `supabase/functions/_shared/catalogCache.ts` | Bump to v8 |

### Expected Result
- Gaming tab returns actual consoles (PS5, Xbox, Switch) from eBay
- Old cached lots/bundles/shoes are filtered out even on cache hit
- "Xbox 360 Console W/ CABLES" is kept (single console + cables, not a lot)
- "Lot of 40 Power Tested Mixed" is still dropped
