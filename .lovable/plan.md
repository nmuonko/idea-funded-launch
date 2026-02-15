

# Fix Publish Failure: Clean Up Conflicting Migration Files

## Problem

There are 5 migration files from today's session that create/drop the same unique index on `home_recipe_seeds(recipe_id, sort_order)` in conflicting ways. When the publish system runs these against the Live database sequentially:

1. Migration `050217` adds `sort_order` with `DEFAULT 0` and `NOT NULL` -- all existing rows get `sort_order = 0`
2. Migration `050521` tries to create a unique index -- **FAILS** because all rows have `sort_order = 0`

Even though a later migration (`052512`) tries to fix this with a backfill-then-create approach, and the final migration (`122759`) drops the index entirely, the process never gets past step 2.

## Solution

Consolidate all 5 migration files into a single clean migration that:
- Adds the 4 new columns (`sort_order`, `max_items`, `required_terms`, `excluded_terms`) with safe defaults
- Backfills `sort_order` with unique sequential values per recipe
- Adds the `max_items` check constraint
- Does NOT create the unique index (managed at application level per earlier decision)

## Files Changed

| File | Change |
|------|--------|
| `supabase/migrations/20260215050217_*.sql` | Rewrite to contain the consolidated, safe migration |
| `supabase/migrations/20260215050521_*.sql` | Empty out (keep file, set to no-op comment) |
| `supabase/migrations/20260215051302_*.sql` | Empty out |
| `supabase/migrations/20260215052512_*.sql` | Empty out |
| `supabase/migrations/20260215122632_*.sql` | Empty out |
| `supabase/migrations/20260215122759_*.sql` | Empty out |

## Technical Details

### Consolidated Migration (in the first file)

```sql
-- Add columns safely
ALTER TABLE public.home_recipe_seeds ADD COLUMN IF NOT EXISTS sort_order INTEGER;
ALTER TABLE public.home_recipe_seeds ADD COLUMN IF NOT EXISTS max_items INTEGER;
ALTER TABLE public.home_recipe_seeds ADD COLUMN IF NOT EXISTS required_terms TEXT[];
ALTER TABLE public.home_recipe_seeds ADD COLUMN IF NOT EXISTS excluded_terms TEXT[];

-- Set defaults
ALTER TABLE public.home_recipe_seeds ALTER COLUMN max_items SET DEFAULT 3;
ALTER TABLE public.home_recipe_seeds ALTER COLUMN required_terms SET DEFAULT '{}';
ALTER TABLE public.home_recipe_seeds ALTER COLUMN excluded_terms SET DEFAULT '{}';
ALTER TABLE public.home_recipe_seeds ALTER COLUMN sort_order SET DEFAULT 0;

-- Fill NULLs
UPDATE home_recipe_seeds SET max_items = 3 WHERE max_items IS NULL;
UPDATE home_recipe_seeds SET required_terms = '{}' WHERE required_terms IS NULL;
UPDATE home_recipe_seeds SET excluded_terms = '{}' WHERE excluded_terms IS NULL;

-- Backfill sort_order with unique values per recipe
DO $$
DECLARE rec RECORD; seed RECORD; i INTEGER;
BEGIN
  FOR rec IN (SELECT DISTINCT recipe_id FROM home_recipe_seeds) LOOP
    i := 1;
    FOR seed IN (
      SELECT id FROM home_recipe_seeds
      WHERE recipe_id = rec.recipe_id
      ORDER BY COALESCE(sort_order, 999999), weight DESC, created_at ASC, id ASC
    ) LOOP
      UPDATE home_recipe_seeds SET sort_order = i WHERE id = seed.id;
      i := i + 1;
    END LOOP;
  END LOOP;
END $$;

-- Set NOT NULL
ALTER TABLE public.home_recipe_seeds ALTER COLUMN sort_order SET NOT NULL;
ALTER TABLE public.home_recipe_seeds ALTER COLUMN max_items SET NOT NULL;
ALTER TABLE public.home_recipe_seeds ALTER COLUMN required_terms SET NOT NULL;
ALTER TABLE public.home_recipe_seeds ALTER COLUMN excluded_terms SET NOT NULL;

-- Add check constraint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'home_recipe_seeds_max_items_check') THEN
    ALTER TABLE public.home_recipe_seeds
      ADD CONSTRAINT home_recipe_seeds_max_items_check CHECK (max_items >= 1 AND max_items <= 5);
  END IF;
END $$;

-- Clean up any leftover indexes (no unique index created)
DROP INDEX IF EXISTS home_recipe_seeds_recipe_sort_order_uidx;
DROP INDEX IF EXISTS idx_home_recipe_seeds_recipe_sort;
```

### Remaining Migration Files

Each will contain only:

```sql
-- no-op: consolidated into earlier migration
```

This ensures all 6 files still exist (the system tracks them by filename) but only the first one does any work, and it handles all edge cases safely.

