
ALTER TABLE public.home_recipe_seeds 
ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0;

-- Backfill: assign sort_order based on current weight DESC ordering per recipe
WITH numbered AS (
  SELECT id, ROW_NUMBER() OVER (
    PARTITION BY recipe_id ORDER BY weight DESC, created_at ASC
  ) AS rn
  FROM home_recipe_seeds
)
UPDATE home_recipe_seeds SET sort_order = numbered.rn
FROM numbered WHERE home_recipe_seeds.id = numbered.id;
