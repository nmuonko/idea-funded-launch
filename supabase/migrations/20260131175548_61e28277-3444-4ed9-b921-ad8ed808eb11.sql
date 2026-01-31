-- Fix: Allow additional home cache types in catalog_cache table
-- The prewarm worker uses home_amazon, home_ebay, home_mixed cache types
-- but the CHECK constraint only allowed: home, search, product, offers

ALTER TABLE public.catalog_cache 
DROP CONSTRAINT IF EXISTS catalog_cache_cache_type_check;

ALTER TABLE public.catalog_cache 
ADD CONSTRAINT catalog_cache_cache_type_check 
CHECK ((cache_type = ANY (ARRAY[
  'home', 'search', 'product', 'offers',
  'home_amazon', 'home_ebay', 'home_mixed'
])));