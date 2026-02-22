

## Fix: Publish Blocked by Missing Tables on Live

### Problem
Publishing fails because the migration for `enqueue_all_seeds_ebay` references the `catalog_refresh_queue` table, which exists in Test but **not in Live**. Several earlier migrations that create backend tables apparently never applied to Live.

Missing tables on Live:
- `catalog_refresh_queue`
- `catalog_category_ttl`
- `auto_seed_promotions`
- `search_query_log`

### Solution

**Update the migration file** (`20260221173030_dc26d292-...`) to be self-contained by prepending `CREATE TABLE IF NOT EXISTS` statements for all missing tables before the function definition. This way, when it runs on Live, the tables get created first, then the function succeeds.

### Technical Steps

**Step 1 -- Rewrite the migration to include prerequisite table creation**

Add to the top of migration `20260221173030`:
- `CREATE TABLE IF NOT EXISTS public.catalog_refresh_queue (...)` with all columns, indexes, and RLS
- `CREATE TABLE IF NOT EXISTS public.catalog_category_ttl (...)`  
- `CREATE TABLE IF NOT EXISTS public.auto_seed_promotions (...)`
- `CREATE TABLE IF NOT EXISTS public.search_query_log (...)`
- The dedup index `uq_refresh_queue_dedupe`

All using `IF NOT EXISTS` so they are safe no-ops on Test (where they already exist) but create the tables on Live.

Then keep the existing `enqueue_all_seeds_ebay` function + REVOKE statements.

**Step 2 -- Publish**

After the migration is updated, publishing should succeed since all referenced tables will exist before the function is created.

### Risk Assessment
- **Test**: No impact -- all `IF NOT EXISTS` statements are no-ops
- **Live**: Tables get created empty (no data), function gets created, publish unblocks
- **No data loss**: No destructive operations involved

