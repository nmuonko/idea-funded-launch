

## Fix: Publish Still Blocked -- Migration Ordering Issue

### Root Cause

The migration order on Live is:

1. `20260221031103` -- Creates `catalog_refresh_queue` table (may fail on Live due to ALTER TABLE on `catalog_items`)
2. `20260221035323` -- Creates `claim_refresh_queue_jobs` function with `RETURNS SETOF public.catalog_refresh_queue` -- **FAILS here** because the table/type doesn't exist yet
3. `20260222020214` -- My previous fix creates the table with `IF NOT EXISTS` -- never reached

The table creation in my fix comes too late in the migration sequence.

### Solution

**Move the `CREATE TABLE IF NOT EXISTS` for `catalog_refresh_queue` into migration `20260221035323`**, right before the function definition. This ensures the table exists as a type before `RETURNS SETOF` references it, regardless of whether the earlier migration succeeded.

Also remove the redundant table creation from `20260222020214` since it will no longer be needed there.

### Technical Steps

**Step 1 -- Update migration `20260221035323`**

Prepend the `CREATE TABLE IF NOT EXISTS public.catalog_refresh_queue (...)` statement (with all columns) before the `CREATE OR REPLACE FUNCTION` statement.

**Step 2 -- Simplify migration `20260222020214`**

Remove the `catalog_refresh_queue` table creation from this file since it will already exist. Keep the other three table creations (`catalog_category_ttl`, `search_query_log`, `auto_seed_promotions`) and the `enqueue_all_seeds_ebay` function.

### Risk Assessment
- **Test**: No impact -- `IF NOT EXISTS` is a no-op since the table already exists
- **Live**: Table gets created before the function, unblocking the chain
- **No data loss**: No destructive operations

