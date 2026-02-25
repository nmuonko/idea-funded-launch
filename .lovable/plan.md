

## Fix: Admin Category Count + Frontend Price Filter

### Issue 1: Admin Cached Products shows "0 items in phones"

**Root cause**: The edge function `admin-catalog-items` runs a count query (`select("*", { count: "exact", head: true })`) but if it errors silently, `count` is `null`, and `count ?? 0` becomes `0`. Additionally, the DB fallback path (used when edge function fails) doesn't return `filtered_count` at all, so the badge shows nothing or 0.

**Fix** (`supabase/functions/admin-catalog-items/index.ts`):
- Log and handle errors from the count query explicitly
- If count query fails, run a simpler RPC-based count or retry

**Fix** (`src/pages/admin/CatalogCache.tsx`):
- In the DB fallback path (line ~838), add a separate count query using `select("*", { count: "exact", head: true })` with the same filters, and include `filtered_count` in the returned object
- This ensures the count displays correctly even when the edge function is down

### Issue 2: Frontend search filters - show only price slider up to $500,000

**Current state**: The search results page (`SearchResults.tsx`) shows three filter controls:
1. Provider dropdown (Amazon, eBay, etc.)
2. Sort dropdown
3. Price range slider inside a Sheet (max $5,000)

**Changes** (`src/pages/shop/SearchResults.tsx`):
- Remove the Provider filter dropdown entirely from the UI
- Keep the Sort dropdown (sorting is not a filter)
- Move the price slider out of the hidden Sheet and display it inline as a visible scrolling range slider
- Change the price range max from `5000` to `500000` and adjust step to `500`
- Remove the Sheet/Filters button since the only filter (price) will be inline
- Update the price display to format large numbers with commas
- Keep `providerFilter` state internally (defaulting to 'all') so the search API contract doesn't break

### Files to change

| File | Change |
|------|--------|
| `supabase/functions/admin-catalog-items/index.ts` | Add error handling to count query |
| `src/pages/admin/CatalogCache.tsx` | Add `filtered_count` to DB fallback path |
| `src/pages/shop/SearchResults.tsx` | Remove provider filter, inline price slider, increase max to 500k |

