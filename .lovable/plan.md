
# Catalog Builder + Enhanced Cache Admin (with 6 Must-Fix Risks Resolved)

## Overview

This plan implements the full Catalog Builder system and enhanced Catalog Cache admin portal, incorporating all 6 reviewer-identified risks as mandatory fixes before deployment.

---

## Risk Mitigations (Built Into Implementation)

### Risk 1: eBay Pagination -- Stateful Offset Tracking
- Store `current_offset` in `catalog_builder_state` per source (not cursor -- eBay Browse API uses offset)
- Advance offset after each successful page fetch
- Mark source `exhausted` when: offset >= total returned by eBay OR 2-3 consecutive empty pages

### Risk 2: Rate Limit Protection -- Per-Run Request Budget
- Global `MAX_REQUESTS_PER_RUN = 40` (hard cap on eBay API calls per worker invocation)
- Delay between calls: `1000ms` (not 800ms)
- On any 429: immediately stop the entire run, record provider health failure, let next cron pick up
- Category diversification: process sources round-robin across categories, not sequentially

### Risk 3: Accurate Unique Item Counting
- Add `first_seen_at` column to `catalog_items` (default `now()`, never updated on upsert)
- After upsert batch, count rows where `first_seen_at` falls within the current run window to get true `new_unique_items`
- Campaign `achieved_*` counters use only new unique items, not upsert count
- `catalog_builder_runs.new_unique_items` vs `items_upserted` tracked separately

### Risk 4: Popularity Score -- No DB Write Storm
- Do NOT increment on every search result
- Product detail view: always increment +3 (low volume, acceptable)
- Search results: write to a lightweight `product_popularity_events` table (product_id, delta, created_at)
- Aggregate nightly via a simple SQL function that sums deltas and updates `catalog_items.popularity_score`
- This avoids hot-row contention under traffic

### Risk 5: Cron Security -- No Anon Key Allowed
- Builder mode reuses existing `checkAuth()` which already rejects anon keys
- New campaign cron uses `_cron_call_refresh_worker` pattern (x-internal-cron-key from vault)
- Admin edge function calls worker internally using service_role -- never exposes trigger to browser

### Risk 6: Provider Health Persisted to DB
- New `provider_health_status` table: `provider TEXT PK, healthy BOOLEAN, reason TEXT, unhealthy_until TIMESTAMPTZ, consecutive_failures INT, updated_at TIMESTAMPTZ`
- Worker writes to this table on every 402/429/5xx event and on recovery
- Admin UI reads from DB (durable across deploys), not in-memory circuit breaker
- In-memory circuit breaker still used for runtime fast-path; DB is source of truth for admin display

---

## Database Changes (Single Migration)

### New Tables

**`catalog_builder_sources`**
- id (uuid PK), category_key (text), provider (text: 'ebay'|'rainforest'), source_type (text: 'seed_query'|'ebay_category'), source_value (text), enabled (boolean default true), priority (int default 10), created_at, updated_at
- RLS: admin-only via `has_role(auth.uid(), 'admin')`

**`catalog_builder_state`**
- source_id (uuid PK, FK to sources ON DELETE CASCADE), current_offset (int default 0), total_ingested (int default 0), exhausted (boolean default false), last_run_at (timestamptz), last_error (text nullable)
- RLS: admin-only

**`catalog_builder_goals`**
- id (uuid PK), status (text: 'running'|'completed'|'canceled'), start_at (timestamptz), end_at (timestamptz), goal_total (int), goal_ebay (int), goal_rainforest (int), achieved_total (int default 0), achieved_ebay (int default 0), achieved_rainforest (int default 0), continuous (boolean default true), created_by (uuid), created_at, updated_at, last_run_at, last_error (text nullable)
- RLS: admin-only

**`catalog_builder_runs`**
- id (uuid PK), goal_id (uuid nullable FK), provider (text), started_at (timestamptz), finished_at (timestamptz), items_upserted (int default 0), new_unique_items (int default 0), duplicates_skipped (int default 0), rate_limited_count (int default 0), duration_ms (int default 0), sources_processed (int default 0)
- RLS: admin-only

**`provider_health_status`**
- provider (text PK), healthy (boolean default true), reason (text nullable), unhealthy_until (timestamptz nullable), consecutive_failures (int default 0), updated_at (timestamptz default now())
- RLS: admin-only read, service_role write

**`product_popularity_events`**
- id (uuid PK), product_id (text), delta (int), created_at (timestamptz default now())
- RLS: service_role only (edge functions write, nightly aggregation reads)
- Index on created_at for efficient nightly cleanup

### Altered Tables

**`catalog_items`** -- add column:
- `first_seen_at` (timestamptz, default now(), never updated on upsert conflicts)

### New DB Function

**`aggregate_popularity_scores()`** -- nightly cron
- Sums `product_popularity_events.delta` grouped by `product_id`
- Updates `catalog_items.popularity_score += sum` for each product
- Deletes processed events
- Returns count of products updated

---

## Edge Function: `admin-catalog-items` Enhancements

### New query parameters for `mode=list`:
- `sort_by`: "newest" (first_seen_at DESC), "recently_seen" (last_seen_at DESC), "highest_price" (price_usd DESC), "popularity" (popularity_score DESC) -- default: existing sort
- `date_from` / `date_to`: filter by first_seen_at range
- `date_preset`: "24h", "7d", "30d" (shorthand)

### New modes:
- `mode=builder-status`: Returns active campaign progress, queue depth, items added in last 24h, provider health from `provider_health_status` table
- `mode=search-insights`: Returns top queries (from search_query_log via existing RPC) and top products by popularity_score

### New POST actions:
- `action=run-builder`: Triggers `catalog-refresh-worker` with `mode=catalog-builder` and specified `provider` param. Uses service_role internally.
- `action=start-campaign`: Creates a `catalog_builder_goals` record. Validates inputs.
- `action=cancel-campaign`: Sets active campaign status to 'canceled'

---

## Edge Function: `catalog-refresh-worker` -- New `mode=catalog-builder`

### New mode behavior:
1. Check for active campaign goal (status='running'); if goal met (using accurate unique counts) or window expired, mark completed and return
2. Check `admin_settings` for `builder_paused` flag
3. Read `catalog_builder_sources` (enabled, not exhausted), ordered by priority, round-robin across categories
4. For each source:
   - Read `catalog_builder_state` to get `current_offset`
   - Fetch from eBay with `limit=100, offset=current_offset`
   - Track `requests_this_run` against `MAX_REQUESTS_PER_RUN (40)`
   - On 429: stop entire run, update `provider_health_status` table, record in `catalog_builder_runs`
   - Upsert results into `catalog_items` with `first_seen_at` preserved (ON CONFLICT DO UPDATE SET ... but NOT first_seen_at)
   - After upsert, count new unique items (where first_seen_at >= run_start_time among upserted IDs)
   - Update `catalog_builder_state`: advance offset, increment total_ingested
   - **Uniqueness gate**: if page returns >70% duplicates (items already in DB), mark source `exhausted`
   - Stop if empty results 2+ consecutive times per source
5. Update `catalog_builder_goals.achieved_*` with accurate new unique counts
6. Log run to `catalog_builder_runs`
7. Update `provider_health_status` on success (mark healthy) or failure
8. Enforce 45s time budget

### Existing modes unchanged (queue, stale, pool-fill, seed-backfill)

### eBay fetch changes:
- `searchEbay()`: accept `offset` parameter (currently hardcoded to 0), increase default limit to 100
- 1000ms delay between calls (was 600-800ms)

---

## Admin UI: Enhanced `/admin/catalog-cache`

### New sections added to existing page:

**A) Run Control Buttons** (below summary cards):
- "Run eBay Builder Now" -- calls `action=run-builder` with provider=ebay
- "Run Amazon Builder Now" -- calls `action=run-builder` with provider=rainforest; disabled with warning if provider unhealthy
- "Automate Window Run" -- opens dialog with:
  - run_window_days (default 7)
  - goal_total_items (default 10,000)
  - goal_ebay_items (default 5,000)
  - goal_amazon_items (default 5,000)
  - Continuous mode toggle (default ON -- "keep going past goal")
  - "Start Campaign" button

**B) Campaign Progress Panel** (visible when campaign active):
- Progress bars: achieved_ebay/goal_ebay, achieved_rainforest/goal_rainforest, achieved_total/goal_total
- Time remaining in window
- Provider health from `provider_health_status` table (persistent, not in-memory)
- "Cancel Campaign" button

**C) Enhanced Filters** (in existing items table):
- New "Sort by" dropdown: Newest Added, Recently Seen, Highest Price, Popularity
- New "Date Added" filter: Last 24h, Last 7d, Last 30d, Custom range
- Existing filters remain unchanged

**D) Search Insights Panel** (collapsible section):
- Top searched queries with counts
- Most popular products by popularity_score (top 20)

---

## New Admin Page: `/admin/catalog-builder`

Separate page focused on builder source management:
- Table of `catalog_builder_sources` with enable/disable toggles
- "Add Source" form (category + query or eBay category ID + provider)
- "Reset Progress" button per source (clears state to re-crawl)
- "Pre-seed" button: bulk-insert ~200 high-value eBay category sources
- Builder state per source: offset, total ingested, exhausted status
- Run history from `catalog_builder_runs` (last 20 runs with stats)

---

## Admin Navigation

Add to `AdminLayout.tsx` System section:
- "Catalog Builder" with Hammer icon, linking to `/admin/catalog-builder`

Register route in `App.tsx` with lazy import.

---

## Cron Jobs (via SQL insert tool)

- `catalog-builder-campaign`: every 10 minutes, calls `catalog-refresh-worker` with `mode=catalog-builder`
  - Uses `_cron_call_refresh_worker` pattern with vault secret
- `aggregate-popularity`: daily at 4 AM, calls `aggregate_popularity_scores()` RPC

---

## Popularity Score Tracking

- `catalog-product` (product detail view): increment `popularity_score` +3 directly (low volume)
- `catalog-search` (search results): insert batch into `product_popularity_events` table with delta=+1 for first 10 results, sampled 1-in-5 searches
- Nightly aggregation function processes events into `catalog_items.popularity_score`

---

## Files Summary

| File | Action |
|------|--------|
| Database migration | **Create** -- 6 new tables + 1 new column + 1 new function |
| `supabase/functions/catalog-refresh-worker/index.ts` | **Modify** -- add `mode=catalog-builder`, fix searchEbay offset param, increase limit to 100, 1000ms delay, per-run request budget, uniqueness gate, provider health DB writes |
| `supabase/functions/admin-catalog-items/index.ts` | **Modify** -- add sort_by, date filters, builder-status, run-builder, start-campaign, cancel-campaign, search-insights |
| `src/pages/admin/CatalogCache.tsx` | **Modify** -- add run control buttons, campaign progress, date/sort filters, search insights |
| `src/pages/admin/CatalogBuilder.tsx` | **Create** -- builder source management page |
| `src/components/layout/AdminLayout.tsx` | **Modify** -- add Catalog Builder nav item |
| `src/App.tsx` | **Modify** -- add route |
| Cron SQL (insert tool) | **Create** -- 2 new cron schedules |
| `supabase/functions/catalog-search/index.ts` | **Modify** -- sampled popularity event writes |
| `supabase/functions/catalog-product/index.ts` | **Modify** -- direct popularity_score +3 increment |

## What Does NOT Change
- Auto-Learning page and pipeline
- ShopHome grids / curated home recipes
- Existing catalog_items data (never hard-deleted)
- Search pipeline core logic (DB-first + AI rewrite + auto-cache)
