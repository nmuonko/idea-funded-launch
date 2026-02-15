
-- Unique index to prevent duplicate sort_order per recipe
CREATE UNIQUE INDEX IF NOT EXISTS idx_home_recipe_seeds_recipe_sort 
ON public.home_recipe_seeds (recipe_id, sort_order);
