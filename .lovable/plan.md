

# Search Relevancy Test Suite and Report

## Overview
Build an automated search relevancy testing system that runs 100+ queries against the live `catalog-search` edge function, evaluates result quality using intent-specific heuristics, stores reports in the database, and displays results in an admin-only UI page.

## Components

### 1. Database Migration (2 new tables)

**`search_relevancy_reports`** - One row per test run:
- `id` (uuid, PK)
- `created_at` (timestamptz)
- `env` (text) - "production" or "staging"
- `total_queries` (int)
- `pass_count` (int)
- `fail_count` (int)
- `avg_latency_ms` (int)
- `slow_count` (int) - queries exceeding 4500ms

**`search_relevancy_report_rows`** - One row per query tested:
- `id` (uuid, PK)
- `report_id` (uuid, FK to reports with cascade delete)
- `created_at` (timestamptz)
- `category` (text) - e.g., "phones", "vehicles", "appliances"
- `query` (text)
- `returned_count` (int)
- `top3_relevant` (int)
- `top12_relevant` (int)
- `parts_bleed_rate` (numeric)
- `zero_price_count` (int)
- `missing_image_count` (int)
- `latency_ms` (int)
- `provider_amazon_count` (int)
- `provider_ebay_count` (int)
- `fail_reasons` (text[])
- `sample_top3_titles` (text[])
- `debug` (jsonb) - stores headers (intent, debug, correlation-id, cache-control)

RLS: Enable RLS. Admin-only read policy using `is_admin_role()`. Service role writes (edge function uses service role key).

### 2. Edge Function: `admin-search-relevancy-run`

**Auth**: Uses `verifyAndGetUser` + admin role check (same pattern as `admin-cache-clear`).

**Flow**:
1. Accept POST with optional `{ env: "production" | "staging" }` (default: "production")
2. Create a report row in `search_relevancy_reports`
3. Loop through the 100+ test queries sequentially with 200ms delay between each
4. For each query:
   - Call `catalog-search` via internal fetch (same URL pattern the app uses)
   - Measure latency
   - Capture response headers (`x-afrishop-search-debug`, `x-afrishop-search-intent`, `x-correlation-id`, `cache-control`)
   - Extract items, count providers, count $0 prices, count missing images
   - Run relevancy evaluation against the top 12 items using the keyword lists and category-specific rules
   - Assign fail reasons
   - Insert row into `search_relevancy_report_rows`
5. Update the report summary (pass/fail counts, avg latency, slow count)
6. Return the full report JSON

**Query List**: All 100+ queries from the prompt, organized by category (phones, appliances, vehicles, agriculture, gaming, fashion, baby/home, typos).

**Relevancy Evaluation Logic** (embedded in the edge function):
- Category-specific keyword lists (ACCESSORY_WORDS, VEHICLE_PARTS_WORDS, PHONE_BRANDS, APPLIANCE_WORDS, GAMING_WORDS, FASHION_WORDS, BABY_HOME_WORDS)
- Intent detection per query to determine which evaluation rules apply
- Pass thresholds: top3 >= 2 relevant AND top12 >= 7 relevant
- Fail reasons: ZERO_RESULTS, LOW_RELEVANCY_TOP3, LOW_RELEVANCY_TOP12, HIGH_PARTS_BLEED, ACCESSORY_DOMINATION, ZERO_PRICE_ITEMS_PRESENT, MISSING_IMAGE_ITEMS_PRESENT, PROVIDER_TIMEOUT_OR_ERROR, SLOW_QUERY

**Config**: `verify_jwt = true` in `config.toml`.

### 3. Admin UI Page: `/admin/search-relevancy`

**Route**: Add to `App.tsx` under admin routes, guarded by `can_view_dashboard` permission (super admin only).

**Nav**: Add "Search Relevancy" item to the System section in `AdminLayout.tsx` sidebar.

**Page Layout**:
- **Header**: Title + "Run Tests" button (with loading spinner during execution)
- **Summary Cards**: Total queries, Pass count (green), Fail count (red), Avg latency, Slow queries
- **Filters**: Toggle buttons for "All", "Failures Only", "Slow Only"
- **Results Table**: Columns: Category, Query, Returned, Top3Rel, Top12Rel, PartsBleed, $0, NoImage, Latency(ms), FailReasons, SampleTop3
  - Color-coded rows: green for pass, red for fail
  - Fail reasons shown as badges
  - Sample titles truncated with tooltip for full text
- **History**: Dropdown to select previous reports by date

### 4. Files to Create/Modify

**New files**:
- `supabase/functions/admin-search-relevancy-run/index.ts` - Edge function
- `src/pages/admin/SearchRelevancy.tsx` - Admin page

**Modified files**:
- `src/App.tsx` - Add route for `/admin/search-relevancy`
- `src/components/layout/AdminLayout.tsx` - Add nav item to System section
- `supabase/config.toml` - Add `[functions.admin-search-relevancy-run]` with `verify_jwt = true`

**Database migration**: Create both tables with RLS policies.

### Technical Notes

- The edge function calls `catalog-search` internally via `fetch()` to the Supabase functions URL, passing the admin's auth token and apikey
- Sequential execution with 200ms delays prevents overwhelming the search endpoint
- The function may take 30-60 seconds for 100+ queries; the admin UI should handle long-running requests with a loading state
- Reports are persisted so historical comparisons are possible
- No changes to `catalog-search` itself - this is purely observational testing

