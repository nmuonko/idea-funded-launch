
# Fix Gaming Tab: Force Cache Bust + Add Missing Drop Rules

## Problem
The gaming scorer already has condition filters, lot/bundle drops, and broken/parts drops. However:
1. **Client-side cache is stale** -- `CACHE_PREFIX` is `v7` and hasn't been bumped since these rules were added, so users see old cached results.
2. **Server-side cache version** (`AMAZON_CACHE_VERSION = "v6"`) also needs a bump to invalidate server DB cache entries.
3. **Missing drop keywords**: "w/ cables", "w/ games", "avec cables", "avec jeux", "with cables", "with games" are not in the scorer's drop list.

## Changes (3 files)

### 1. `src/lib/catalogCache.ts` (line 6)
Bump client-side cache prefix to flush all stale localStorage entries:
```
Before: const CACHE_PREFIX = 'afrishop_cache:v7:';
After:  const CACHE_PREFIX = 'afrishop_cache:v8:';
```

### 2. `supabase/functions/_shared/catalogCache.ts` (line 15)
Bump server-side cache version to invalidate all DB-cached search results:
```
Before: export const AMAZON_CACHE_VERSION = "v6";
After:  export const AMAZON_CACHE_VERSION = "v7";
```

### 3. `supabase/functions/_shared/searchIntentScorer.ts` (lines 190-194)
Add missing "with cables/games" keywords to the LOT_BUNDLE_DROP list inside the `gaming` case:

Add these to the existing `LOT_BUNDLE_DROP` array:
- `"w/ cables"`, `"with cables"`, `"avec cables"`, `"avec câbles"`
- `"w/ games"`, `"with games"`, `"avec jeux"`
- `"w games"`, `"consoles & games"`
- `"mega"`

These are already requested in the prompt but were never added to the scorer.

## Summary

| File | Change |
|------|--------|
| `src/lib/catalogCache.ts` | Bump `CACHE_PREFIX` to `v8` (client cache bust) |
| `supabase/functions/_shared/catalogCache.ts` | Bump `AMAZON_CACHE_VERSION` to `v7` (server cache bust) |
| `supabase/functions/_shared/searchIntentScorer.ts` | Add "w/ cables", "with games", "avec jeux", "mega", etc. to gaming drop list |

After these changes, all users will get fresh results on next load, and any "w/ cables" or "w/ games" bundle listings will be dropped.
