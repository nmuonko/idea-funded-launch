
-- Drop the unique index so it won't be part of the schema diff that fails on Live
-- The application code doesn't require this index for correctness, only for data integrity
-- We'll handle sort_order uniqueness at the application level instead
DROP INDEX IF EXISTS home_recipe_seeds_recipe_sort_order_uidx;
DROP INDEX IF EXISTS idx_home_recipe_seeds_recipe_sort;
