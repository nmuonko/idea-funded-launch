

## Fix Summary Cards and Handle Obsolete Product Links

### Problem 1: Summary Cards Show 0 for Everything Except Total

The `handleSummary` edge function runs 7+ sequential `count` queries taking 5+ seconds. The frontend catches errors silently and falls back to `{}`, which renders all counts as 0. Meanwhile, the direct DB count query for "Total" uses a separate, faster query that works fine.

**Fix**: Mirror the same direct-DB-count approach used for Total across all summary metrics. Replace the single slow edge function call with parallel direct Supabase client queries from the frontend (active, inactive, added 24h, stale price, dead). This is faster, more reliable, and eliminates the single-point-of-failure edge function call.

**Files**: `src/pages/admin/CatalogCache.tsx` (SummaryCards component, lines 74-145)

**Changes**:
- Add separate `useQuery` hooks for each metric (active, inactive, dead, added_24h, stale_price) using direct `supabase.from('catalog_items').select('*', { count: 'exact', head: true })` with appropriate filters
- Remove dependency on the `summary` edge function mode (keep it as optional fallback)
- Run all count queries in parallel for speed

### Problem 2: Obsolete/Dead Links Not Being Detected

The system already has a stale-refresh mechanism (`refreshStaleItems` in `catalog-refresh-worker`) that checks eBay item URLs and increments `fail_count` on 404/410 responses, deactivating items after 3 failures. However, this only runs when the worker is in `stale` mode and items have old `price_updated_at` dates.

**What's missing**: There's no proactive link-checking for the 72K+ items that were bulk-ingested recently. They all show `fail_count: 0` and `is_active: true` because they've never been verified.

**Fix**: Add a new `link-check` mode to the catalog-refresh-worker that batch-validates product URLs by hitting the eBay Browse API `/item/{id}` endpoint. Items returning 404/410 get their `fail_count` incremented and are deactivated after 3 failures. Add a "Check Links" button in the admin UI to trigger this.

**Files**:
- `supabase/functions/catalog-refresh-worker/index.ts` -- Add `link-check` mode
- `supabase/functions/admin-catalog-items/index.ts` -- Add `run-link-check` action
- `src/pages/admin/CatalogCache.tsx` -- Add "Check Links" button and show results

### Problem 3: Summary Cards Should Reflect Real Data

The DB currently shows: 72,993 total, 72,993 active, 0 inactive, 0 dead, 50,351 added in 24h. Once the direct-query approach works, these real numbers will display correctly.

---

### Detailed Technical Plan

#### 1. Fix SummaryCards -- Direct DB Queries (CatalogCache.tsx)

Replace the single `summary` edge function call with parallel direct queries:

```text
// Each as its own useQuery with staleTime: 60_000
const { data: activeCount } = useQuery({
  queryKey: ['catalog-items-active-count'],
  queryFn: async () => {
    const { count } = await supabase.from('catalog_items')
      .select('*', { count: 'exact', head: true })
      .eq('is_active', true);
    return count ?? 0;
  },
});

// Similar for: inactive, dead (fail_count >= 3), added_24h (first_seen_at >= 24h ago), stale_price
```

Remove the `invokeAdmin({ mode: 'summary' })` call entirely from SummaryCards.

#### 2. Add Link-Check Mode (catalog-refresh-worker)

New function `runLinkCheck`:
- Fetches a batch of active items (default 50, max 200) that haven't been checked recently (`last_checked_at` is null or older than 7 days)
- For each item, calls the eBay Browse API `/item/{provider_product_id}`
- On 404/410: increments `fail_count`, sets `status_reason = 'check_failed'`, deactivates if `fail_count >= 3`
- On 200: resets `fail_count = 0`, updates `last_checked_at`, confirms `is_active = true`
- On 429: stops immediately
- Returns `{ checked, active, deactivated }`

#### 3. Add Admin Action (admin-catalog-items)

New action `run-link-check`:
- Accepts optional `batch_size` (default 50) and optional `category_key`
- Calls `catalog-refresh-worker` with `mode: 'link-check'`
- Returns results to frontend

#### 4. Add UI Controls (CatalogCache.tsx)

In the SummaryCards area or as a new utility card:
- "Check Links" button that triggers the link-check
- Shows progress: "Checked X items: Y active, Z deactivated"
- After completion, invalidates summary count queries to refresh the cards

### Files to Modify

| File | Change |
|------|--------|
| `src/pages/admin/CatalogCache.tsx` | Replace SummaryCards edge fn with direct DB queries; add "Check Links" button |
| `supabase/functions/catalog-refresh-worker/index.ts` | Add `link-check` mode using existing `refreshStaleItems` pattern |
| `supabase/functions/admin-catalog-items/index.ts` | Add `run-link-check` action handler |

### Expected Results

- Summary cards immediately show real counts (72,993 Active, 0 Inactive, 50,351 Added 24h, etc.)
- "Check Links" lets you validate batches of products, auto-deactivating dead ones
- Deactivated items show as "Inactive" in the summary and can be filtered in the Items Table
- All changes deploy to Live on publish

