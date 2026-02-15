
-- Ensure sort_order column exists (may already exist from prior migration)
ALTER TABLE public.home_recipe_seeds ADD COLUMN IF NOT EXISTS sort_order INTEGER;
ALTER TABLE public.home_recipe_seeds ADD COLUMN IF NOT EXISTS max_items INTEGER;
ALTER TABLE public.home_recipe_seeds ADD COLUMN IF NOT EXISTS required_terms TEXT[];
ALTER TABLE public.home_recipe_seeds ADD COLUMN IF NOT EXISTS excluded_terms TEXT[];

-- Set defaults for new columns
ALTER TABLE public.home_recipe_seeds ALTER COLUMN max_items SET DEFAULT 3;
ALTER TABLE public.home_recipe_seeds ALTER COLUMN required_terms SET DEFAULT '{}';
ALTER TABLE public.home_recipe_seeds ALTER COLUMN excluded_terms SET DEFAULT '{}';

-- Fill NULLs with defaults
UPDATE home_recipe_seeds SET max_items = 3 WHERE max_items IS NULL;
UPDATE home_recipe_seeds SET required_terms = '{}' WHERE required_terms IS NULL;
UPDATE home_recipe_seeds SET excluded_terms = '{}' WHERE excluded_terms IS NULL;

-- Set NOT NULL constraints
ALTER TABLE public.home_recipe_seeds ALTER COLUMN max_items SET NOT NULL;
ALTER TABLE public.home_recipe_seeds ALTER COLUMN required_terms SET NOT NULL;
ALTER TABLE public.home_recipe_seeds ALTER COLUMN excluded_terms SET NOT NULL;

-- Add max_items check constraint if not exists
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'home_recipe_seeds_max_items_check') THEN
    ALTER TABLE public.home_recipe_seeds ADD CONSTRAINT home_recipe_seeds_max_items_check CHECK (max_items >= 1 AND max_items <= 5);
  END IF;
END $$;

-- Drop ALL possible index names to start fresh
DROP INDEX IF EXISTS idx_home_recipe_seeds_recipe_sort;
DROP INDEX IF EXISTS home_recipe_seeds_recipe_sort_order_uidx;

-- Backfill sort_order with guaranteed unique values per recipe
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
      ORDER BY COALESCE(sort_order, 999999), weight DESC, created_at ASC, id ASC
    ) LOOP
      UPDATE home_recipe_seeds SET sort_order = i WHERE id = seed.id;
      i := i + 1;
    END LOOP;
  END LOOP;
END $$;

-- Now safe to set NOT NULL and default
ALTER TABLE public.home_recipe_seeds ALTER COLUMN sort_order SET NOT NULL;
ALTER TABLE public.home_recipe_seeds ALTER COLUMN sort_order SET DEFAULT 0;

-- Create unique index - guaranteed no duplicates now
CREATE UNIQUE INDEX home_recipe_seeds_recipe_sort_order_uidx 
ON public.home_recipe_seeds (recipe_id, sort_order);
