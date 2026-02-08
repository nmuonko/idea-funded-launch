

# Fix: Vehicle Post-Filter in searchCacheGuard.ts Dropping All Results

## Root Cause

The "toyota prius" search returns 48 cached items. These pass through two separate filter pipelines:

1. **Vehicle Guardrails** (`vehicleGuardrails.ts`) -- the new 3-tier system (strict/relaxed/fallback). This works correctly and has a safe fallback to never return empty.

2. **searchCacheGuard.ts** (lines 139-149) -- an older, separate filter that runs AFTER the guardrails. It uses `VEHICLE_TOY_ACCESSORY_FILTER_KEYWORDS` which includes extremely common words like:
   - `"light"`, `"lights"`, `"led"`, `"kit"`, `"belt"`, `"spring"`, `"sensor"`, `"mirror"`, `"radio"`, `"fits"`, `"bag"`, `"watch"`, `"cap"`, `"hose"`, `"speaker"`

   These words commonly appear in legitimate vehicle listing titles (e.g., "2018 Toyota Prius **LED** headlights, **leather** seats"). The filter drops ALL 47 items, resulting in 0 results.

The logs confirm this:
```
vehicle_cache_filter: 48 -> 47     (price >= $1000, good)
vehicle_post_filter:  47 -> 0      (VEHICLE_TOY_ACCESSORY_FILTER_KEYWORDS, BAD)
```

This happens for ALL accounts/sessions because it is server-side cache filtering.

## Why One Account Works

The kadimisha@gmail.com account likely has a **client-side localStorage cache** (`afrishop_cache:v8:`) from a previous successful fetch (before the filter was added or from a different code path). Other accounts/guests get a cache miss, hit the server, and get 0 results from the `vehicle_post_filter`.

## Fix

**Remove the redundant `VEHICLE_TOY_ACCESSORY_FILTER_KEYWORDS` filter from `searchCacheGuard.ts`** (lines 139-149). The 3-tier guardrails in `vehicleGuardrails.ts` already handle parts/accessories filtering with a safe fallback. This secondary filter:
- Duplicates the guardrails' work
- Has no safe fallback (can go to 0)
- Uses overly broad keywords that match real vehicle listings

### File: `supabase/functions/_shared/searchCacheGuard.ts`

Remove the `VEHICLE_TOY_ACCESSORY_FILTER_KEYWORDS` filter block (lines 139-149) from the `filterCachedItems` function. Keep the price filter (lines 129-137) which correctly enforces the $1000 minimum for vehicle queries.

Also remove the now-unused import of `VEHICLE_TOY_ACCESSORY_FILTER_KEYWORDS` from line 6.

### Redeploy

Redeploy the `catalog-search` edge function (which imports `searchCacheGuard.ts`).

## Technical Detail

```text
BEFORE (current broken flow):
  48 cached items
  -> price >= $1000 filter: 47 items
  -> VEHICLE_TOY_ACCESSORY_FILTER: 0 items  <-- BUG
  -> returned to client: empty

AFTER (fixed flow):
  48 cached items
  -> price >= $1000 filter: 47 items
  -> returned to client: 47 items
  (vehicle guardrails already ran when items were first fetched and cached)
```

## Files Modified

| File | Change |
|------|--------|
| `supabase/functions/_shared/searchCacheGuard.ts` | Remove `VEHICLE_TOY_ACCESSORY_FILTER_KEYWORDS` filter block and its import |

## Expected Results

- ALL accounts and guest browsers see Toyota Prius results
- Vehicle parts/accessories are still filtered by the 3-tier guardrails (which run at fetch time, before caching)
- No more "0 results" for valid vehicle searches

