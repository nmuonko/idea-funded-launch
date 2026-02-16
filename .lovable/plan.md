

# Increase Search Results Volume and Improve Speed

## Problem Summary

Users report two issues:
1. **Too few search results** -- currently capped at ~90 items max (30 per page x 3 pages)
2. **App feels slow** -- multiple layers of latency before results appear

## Root Causes

### Few Results
| Layer | Current Limit | Effect |
|-------|--------------|--------|
| Frontend `limit` param | 30 | Only requests 30 items per API call |
| Frontend page cap | `pageNum < 3` | Stops loading after 3 pages (90 items max) |
| Backend `MAX_LIMIT` | 100 | Even if frontend asked for more, backend caps at 100 |
| eBay API per-request | 100 | Hard API limit per call |
| Amazon cap per query | 200 | Settings default |

### Slowness
| Issue | Detail |
|-------|--------|
| Small batches | 30-item pages require many round-trips to accumulate results |
| TanStack Query staleTime | 2 minutes -- reasonable, not the issue |
| LRU cache size | Only 50 entries -- could evict recent searches |

## Plan

### 1. Backend: Raise MAX_LIMIT to 200

**File: `supabase/functions/catalog-search/index.ts`**
- Change `DEFAULT_LIMIT` from 100 to 200
- Change `MAX_LIMIT` from 100 to 200
- This allows the frontend to request larger batches in a single call
- eBay will still return max 100 per call, but the mixer will combine eBay + Amazon + DB results to fill 200

### 2. Frontend: Request 100 items per page, allow 5 pages

**File: `src/pages/shop/SearchResults.tsx`**
- Change `limit: 30` to `limit: 100` (line 88) -- request 100 items per API call
- Change page cap from `pageNum < 3` to `pageNum < 6` (lines 139, 172) -- allow up to 5 pages = 500 items
- This gives users 100 results immediately, with "Load More" up to 500

### 3. Frontend: Increase LRU cache size for smoother navigation

**File: `src/lib/catalogCache.ts`**
- Change `LRU_MAX_SIZE` from 50 to 100 -- keeps more search results in memory for instant back-navigation

### 4. Backend: Raise DB-first minimum threshold

**File: `supabase/functions/_shared/searchDbFirst.ts`**
- Change `DB_MIN_RESULTS` from 4 to 8 -- require more DB matches before skipping live providers, ensuring richer results

### 5. eBay fetcher: Request full 100 per call

**File: `supabase/functions/_shared/ebayBrowseSearch.ts`**
- Change `DEFAULT_LIMIT` from 20 to 100 -- always request the maximum from eBay API

## Expected Outcome

| Metric | Before | After |
|--------|--------|-------|
| Items on first load | ~30 | ~100 |
| Max items via Load More | ~90 | ~500 |
| API calls to reach 500 items | impossible | 5 |
| eBay items per API call | 20 | 100 |

## Technical Notes

- No database migrations needed -- all changes are in edge functions and frontend code
- The memory constraint on `no-frontend-modification-rule` applies to the Replit mobile app only; the Lovable web frontend can be modified
- eBay Browse API hard limit is 100 per request and max offset 10,000 -- both respected
- Amazon Rainforest API returns variable counts per call -- no change needed there
- Cache keys remain compatible (no version bump needed since the data shape is unchanged)

