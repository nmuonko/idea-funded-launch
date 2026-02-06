

# Surgical Fix: Search Returns 0 Results for Common Queries

## Root Cause Analysis

I tested the live endpoint with `q=google pixel 9` and confirmed it returns **0 items** despite the DB having **162 Pixel items** and **370 Samsung items**.

Three bugs combine to cause this:

1. **No DB-first search path**: The flow is cache -> live providers -> DB fallback. When both Rainforest API returns empty AND eBay token is expired/missing, users get 0 results even though the DB has data.

2. **Broken double `.or()` in amazonFetcher.ts**: The Amazon DB fallback (line 181-185) chains two `.or()` calls. The custom PostgREST client produces duplicate `or=` URL params, which PostgREST doesn't handle correctly. Additionally, `%` wildcards inside `.or()` strings are NOT URL-encoded (unlike the `.ilike()` method which encodes properly), so `%google` gets misinterpreted as percent-encoding.

3. **No token-level matching**: The DB query uses `title.ilike.%google pixel 9%` which requires the EXACT substring. Items titled "Google Pixel 9 Pro" match, but "Pixel 9 128GB Google" would not.

## Solution: Two Changes

### Change 1: Add DB-First Search Step in `catalog-search/index.ts`

Insert ~60 lines after the stale-while-revalidate block (line 579) and before the provider fetch (line 597).

**Logic:**
- Split `qNorm` into tokens (length >= 2)
- Take the 3 longest tokens (most distinctive)
- Query `catalog_items` using chained `.ilike("title", "%token%")` calls (properly URL-encoded by the PostgREST client, ANDed together)
- Safety filters: `is_disallowed` not true, `image_url` not null, `price_usd > 0`
- If results >= MIN_RESULTS (8): return immediately with `meta.source="db"`, write to cache async, fire background live refresh
- If results < 8: continue to existing live provider fetch, merge DB + live results

Example for "google pixel 9":
- Tokens: ["google", "pixel", "9"] -> sorted by length: ["google", "pixel"]
- Query: `title ILIKE '%google%' AND title ILIKE '%pixel%'` -> matches 162 items

### Change 2: Fix Amazon DB Fallback in `amazonFetcher.ts`

Replace the broken double `.or()` (lines 181-185):

```text
// BEFORE (broken):
.or("provider.eq.rainforest,provider.eq.amazon")
.or(`title.ilike.%${query}%,search_text.ilike.%${query}%`)

// AFTER (fixed):
.in("provider", ["rainforest", "amazon"])
.ilike("title", `%${query}%`)
```

Using `.in()` for provider filtering (no `.or()` needed) and `.ilike()` for text matching (properly URL-encoded). This fixes the DB fallback for when the DB-first step is skipped (e.g., vehicle searches with special logic).

## Files Modified

| File | Lines | Change |
|------|-------|--------|
| `supabase/functions/catalog-search/index.ts` | After line 579, before 581 | Insert DB-first search step (~60 lines) |
| `supabase/functions/_shared/amazonFetcher.ts` | Lines 181-185 | Fix broken double `.or()` to `.in()` + `.ilike()` |

## What Does NOT Change

- Homepage (catalog-home) -- not touched
- Cart, checkout, payments -- not touched
- Mobile or web frontend code -- not touched
- Response JSON shape -- existing fields unchanged; `meta.source` adds "db" value
- Product pages, vehicle detection, content blocking -- all unchanged
- Cache TTLs and stale-while-revalidate -- unchanged from previous hotfix

## Expected Results After Fix

- "google pixel 9" -> returns 20+ results from DB in under 200ms
- "samsung galaxy" -> returns 20+ results from DB in under 200ms
- Repeat searches -> served from cache (under 50ms)
- When live providers recover, background refresh updates cache with fresh data

