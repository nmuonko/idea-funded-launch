
# Fix: Bulk Import Not Working in Live (Missing Seed Data)

## Problem
The `catalog_seed_queries` table contains **692 seed queries in Test but 0 in Live**. When you publish, only the table schema is synced -- data is never copied between environments. So when "Start Bulk Import" runs in Live, the `enqueue_all_seeds_ebay` function finds zero seeds to enqueue, and only 8 leftover homepage curation jobs get processed (yielding just 124 products).

## Solution
Copy the 692 seed queries from Test to Live using a SQL insert, then re-run the bulk import.

### Step 1: Export seed data from Test and insert into Live
I will create an edge function action (or use a direct SQL insert via the admin tool) to copy all 692 rows from the Test `catalog_seed_queries` table into the Live `catalog_seed_queries` table.

Since we cannot directly cross-query between environments, I will:
1. Read all seed rows from the Test database
2. Generate an INSERT SQL statement with all 692 rows
3. Run that INSERT in the Live environment

### Step 2: Verify and re-run Bulk Import
After the data is populated in Live, clicking "Start Bulk Import" will correctly enqueue all 692 seeds and begin processing them in batches.

### Step 3: Catalog Cache visibility
The 124 products that were already imported should already be in `catalog_items` in Live. If they don't appear in the Catalog Cache admin page, I'll check whether the cache page queries filter them out (e.g., by category mismatch or `is_active` status).

## Technical Details

| What | Detail |
|------|--------|
| Root cause | `catalog_seed_queries` has 0 rows in Live (data doesn't sync on publish) |
| Test data | 692 enabled seed queries across 24 categories |
| Fix | Insert all seed query rows into Live's `catalog_seed_queries` table |
| Files changed | None -- this is a data-only fix via SQL |
| Risk | Low -- inserting reference data only, no schema changes |
