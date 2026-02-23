

# Fix: Fetch Products Stuck Forever + Progress Bar Not Moving

## Root Cause

Two issues are causing the permanent "Fetching all categories from eBay..." spinner:

### 1. No builder sources enabled
The `catalog_builder_sources` table has only ONE row: `phones/ebay`, and it's **disabled** (`enabled: false`). When you click "Start Fetching" with "All categories", the worker queries for enabled sources, finds none, and returns `{ status: "no_sources" }` immediately.

### 2. Frontend never detects this failure
The `startFetch` function (line 238) only stops the spinner if `worker_result.items_upserted` exists. But `no_sources` returns neither `items_upserted` nor throws an error -- so `isFetching` stays `true` forever, and the progress bar stays at 0/100.

## Fix Plan

### Step 1: Handle all worker response statuses in the frontend

Update `startFetch` in `CatalogCache.tsx` to check for error/empty statuses from the worker (`no_sources`, `paused`, `no_active_sources`, etc.) and surface them as error states instead of hanging forever.

```text
After line 237:
- If worker_result has items_upserted --> done (existing logic)
- If worker_result.status is "no_sources" or similar --> show error: "No builder sources configured"
- If no recognizable result at all --> show error: "Unexpected response"
```

### Step 2: Seed builder sources for all categories

Insert enabled builder sources for all major AfriShop categories so "All categories" and individual category fetches actually work. This covers: electronics, clothing, toys, home, beauty, sports, vehicles, phones, health.

Each source will be an eBay provider row with `enabled: true` and appropriate category keys matching the existing `ALL_CATEGORIES` array.

### Step 3: Add a timeout to the polling loop

Add a safety timeout (e.g., 5 minutes) to the polling interval so it never hangs indefinitely, even if the worker silently fails.

## Technical Details

### File: `src/pages/admin/CatalogCache.tsx`

**startFetch function (lines 236-250):**
After the `postAction` call, add handling for non-success worker results:

```typescript
const workerResult = result?.worker_result;
if (workerResult?.items_upserted !== undefined) {
  // existing success handling...
} else if (workerResult?.status === 'no_sources' || workerResult?.status === 'no_active_sources') {
  setFetchProgress({
    status: 'error',
    message: 'No builder sources configured for this category/provider. Add sources in builder settings.',
    itemsFetched: 0, target: quantity, newUnique: 0, duplicates: 0,
  });
  setIsFetching(false);
} else if (workerResult?.status === 'paused') {
  setFetchProgress({
    status: 'error',
    message: 'Builder is currently paused. Resume it from settings.',
    itemsFetched: 0, target: quantity, newUnique: 0, duplicates: 0,
  });
  setIsFetching(false);
}
// else: worker is running async, polling will pick up completion
```

**Polling timeout (lines 177-216):**
Add a `startTime` ref and check elapsed time in the poll interval. After 5 minutes, auto-stop with error.

### Database: Seed builder sources

```sql
INSERT INTO catalog_builder_sources (provider, category_key, enabled, priority)
VALUES
  ('ebay', 'electronics', true, 10),
  ('ebay', 'clothing', true, 10),
  ('ebay', 'toys', true, 10),
  ('ebay', 'home', true, 10),
  ('ebay', 'beauty', true, 10),
  ('ebay', 'sports', true, 10),
  ('ebay', 'vehicles', true, 10),
  ('ebay', 'health', true, 10)
ON CONFLICT DO NOTHING;

-- Also enable the existing phones source
UPDATE catalog_builder_sources SET enabled = true WHERE category_key = 'phones';
```

### Summary of changes
- **`src/pages/admin/CatalogCache.tsx`**: Handle `no_sources`/`paused` worker responses, add 5-min polling timeout
- **Database migration**: Seed and enable builder sources for all categories

