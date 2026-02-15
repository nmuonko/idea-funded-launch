
-- Step 1: Ensure columns exist
ALTER TABLE public.home_recipe_seeds ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.home_recipe_seeds ADD COLUMN IF NOT EXISTS max_items INTEGER NOT NULL DEFAULT 3;
ALTER TABLE public.home_recipe_seeds ADD COLUMN IF NOT EXISTS required_terms TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE public.home_recipe_seeds ADD COLUMN IF NOT EXISTS excluded_terms TEXT[] NOT NULL DEFAULT '{}';

-- Step 2: Drop index if exists
DROP INDEX IF EXISTS home_recipe_seeds_recipe_sort_order_uidx;

-- Step 3: Temporarily allow NULL, reset, then backfill
ALTER TABLE public.home_recipe_seeds ALTER COLUMN sort_order DROP NOT NULL;
UPDATE home_recipe_seeds SET sort_order = NULL;

-- Step 4: Backfill with unique sequential values per recipe
DO $$
DECLARE
  rec RECORD;
  seed RECORD;
  i INTEGER;
BEGIN
  FOR rec IN (SELECT DISTINCT recipe_id FROM home_recipe_seeds) LOOP
    i := 1;
    FOR seed IN (
      SELECT id FROM home_recipe_seeds 
      WHERE recipe_id = rec.recipe_id 
      ORDER BY weight DESC, created_at ASC
    ) LOOP
      UPDATE home_recipe_seeds SET sort_order = i WHERE id = seed.id;
      i := i + 1;
    END LOOP;
  END LOOP;
END $$;

-- Step 5: Re-add NOT NULL and default
ALTER TABLE public.home_recipe_seeds ALTER COLUMN sort_order SET NOT NULL;
ALTER TABLE public.home_recipe_seeds ALTER COLUMN sort_order SET DEFAULT 0;

-- Step 6: Create unique index
CREATE UNIQUE INDEX home_recipe_seeds_recipe_sort_order_uidx
ON public.home_recipe_seeds (recipe_id, sort_order);
