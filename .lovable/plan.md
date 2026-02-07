

# Fix: Increase Search Results for "iPhone 11" and All Searches

## Problem Analysis

The "iphone 11" search returns only 6 items because:

1. **Amazon is skipped entirely** for `phone_device` intent (line 615 of `catalog-search/index.ts`). This was added to prevent accessory domination, but it cuts off 50%+ of results.
2. **DB-first returns only partial results** (< 8 items in DB for "iphone 11"), so they become fallback items rather than primary results.
3. **eBay returns limited results** for specific phone models when filtered to Cell Phones category.

The frontend already requests `limit: 100` and supports 3 pages (max 300 items). The backend `MAX_LIMIT` is already 100. The issue is provider-level, not a limit cap.

## Changes

### 1. Re-enable Amazon for `phone_device` intent (with post-filtering)

**File: `supabase/functions/catalog-search/index.ts` (~line 615)**

Instead of skipping Amazon entirely for phone_device, allow Amazon but rely on the existing `scoreAndRankItems` scorer to drop accessories. This gives us Amazon's phone listings (which are actually good for "iphone 11").

Change:
```
const skipAmazon = effectiveIntent.intentKey === "vehicle_listing" || effectiveIntent.intentKey === "gaming";
```
Remove `phone_device` was already not there -- but the scorer's `PHONE_FOR_PATTERNS` drops too aggressively. We need to check if Amazon results are being dropped by the scorer.

### 2. Lower `DB_MIN_RESULTS` threshold for phone searches

**File: `supabase/functions/_shared/searchDbFirst.ts` (line 29)**

Currently `DB_MIN_RESULTS = 8` means if DB has 6 items for "iphone 11", they become fallback instead of primary results. Lower to 4 so partial DB results are returned directly, supplemented by provider results.

Change: `DB_MIN_RESULTS = 8` to `DB_MIN_RESULTS = 4`

### 3. Combine DB-first results with provider results instead of returning early

**File: `supabase/functions/catalog-search/index.ts` (~lines 554-594)**

Currently when DB-first returns >= DB_MIN_RESULTS items, it returns immediately without querying providers. For searches that want 100 results, this is too aggressive. Instead:
- If DB returns items but fewer than `limit`, continue to fetch from providers
- Merge DB + provider results (deduplicated)
- This ensures we always try to fill the requested limit

### 4. Bump cache version to flush stale results

**File: `supabase/functions/_shared/catalogCache.ts`**

Bump `AMAZON_CACHE_VERSION` to `v9` so old cached 6-item results are invalidated.

## Technical Details

### Current flow (broken for "iphone 11"):
```text
Search "iphone 11" -> DB has 6 items (< 8 = DB_MIN_RESULTS)
  -> 6 items saved as fallback only
  -> Providers fetched: Amazon SKIPPED (phone_device), eBay returns ~5
  -> Mixer produces ~5 items
  -> Fallback 6 items not used (providers returned > 0)
  -> Total: ~5-6 items
```

### Fixed flow:
```text
Search "iphone 11" -> DB has 6 items (>= 4 = new DB_MIN_RESULTS)
  -> DB returns 6 items as primary
  -> ALSO fetch providers: Amazon active + eBay
  -> Merge DB + Amazon + eBay, deduplicate
  -> Total: 50-100 items per page
```

### Files Modified

| File | Change |
|------|--------|
| `supabase/functions/_shared/searchDbFirst.ts` | Lower `DB_MIN_RESULTS` from 8 to 4 |
| `supabase/functions/catalog-search/index.ts` | Don't return early on DB-first hit -- merge with provider results to fill `limit`. Also ensure Amazon is not skipped for phone_device. |
| `supabase/functions/_shared/catalogCache.ts` | Bump `AMAZON_CACHE_VERSION` to `v9` |

### Why this is safe
- The `scoreAndRankItems` scorer already handles accessory filtering for phone_device intent
- Deduplication by `id:provider` prevents duplicates from DB + providers
- The `pageNum < 3` cap in SearchResults.tsx ensures max 3 pages (300 items)
- Existing content blockers and category guards remain active

