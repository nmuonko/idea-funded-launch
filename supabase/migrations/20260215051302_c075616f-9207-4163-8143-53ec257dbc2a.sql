
-- Add new columns to home_recipe_seeds (sort_order already exists from prior migration)
ALTER TABLE public.home_recipe_seeds ADD COLUMN IF NOT EXISTS max_items INTEGER NOT NULL DEFAULT 3;
ALTER TABLE public.home_recipe_seeds ADD COLUMN IF NOT EXISTS required_terms TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE public.home_recipe_seeds ADD COLUMN IF NOT EXISTS excluded_terms TEXT[] NOT NULL DEFAULT '{}';

-- Add constraint for max_items range
ALTER TABLE public.home_recipe_seeds ADD CONSTRAINT home_recipe_seeds_max_items_check CHECK (max_items >= 1 AND max_items <= 5);

-- Drop existing unique index if it exists (from prior migration) and recreate with proper name
DROP INDEX IF EXISTS idx_home_recipe_seeds_recipe_sort;
CREATE UNIQUE INDEX IF NOT EXISTS home_recipe_seeds_recipe_sort_order_uidx ON public.home_recipe_seeds (recipe_id, sort_order);
