-- ============================================================================
-- Catalog Canonical Keys & Facets Migration
-- Creates tables for key aliases, facets caching, and enhanced nav structure
-- ============================================================================

-- 1) Create catalog_key_aliases table for legacy key mapping
CREATE TABLE IF NOT EXISTS public.catalog_key_aliases (
  alias text PRIMARY KEY,
  canonical_key text NOT NULL,
  created_at timestamptz DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.catalog_key_aliases ENABLE ROW LEVEL SECURITY;

-- Allow public read access
CREATE POLICY "Anyone can read catalog_key_aliases"
  ON public.catalog_key_aliases FOR SELECT
  USING (true);

-- 2) Create catalog_facets_cache for caching Amazon/eBay facets
CREATE TABLE IF NOT EXISTS public.catalog_facets_cache (
  cache_key text PRIMARY KEY,
  provider text NOT NULL,
  resolved_key text NOT NULL,
  query text,
  facets jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '2 hours')
);

-- Enable RLS
ALTER TABLE public.catalog_facets_cache ENABLE ROW LEVEL SECURITY;

-- Allow public read access
CREATE POLICY "Anyone can read catalog_facets_cache"
  ON public.catalog_facets_cache FOR SELECT
  USING (true);

-- Index for expiry cleanup
CREATE INDEX IF NOT EXISTS idx_catalog_facets_cache_expires 
  ON public.catalog_facets_cache(expires_at);

-- Index for lookups
CREATE INDEX IF NOT EXISTS idx_catalog_facets_cache_lookup 
  ON public.catalog_facets_cache(provider, resolved_key);

-- 3) Add more columns to catalog_nav_subtabs if not exists
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'catalog_nav_subtabs' 
    AND column_name = 'ebay_category_id'
  ) THEN
    ALTER TABLE public.catalog_nav_subtabs ADD COLUMN ebay_category_id text;
  END IF;
END $$;

-- 4) Seed catalog_key_aliases with legacy->canonical mappings
INSERT INTO public.catalog_key_aliases (alias, canonical_key) VALUES
  -- Electronics shortcuts
  ('phones', 'electronics_phones'),
  ('phone', 'electronics_phones'),
  ('mobile', 'electronics_phones'),
  ('cellphones', 'electronics_phones'),
  ('smartphones', 'electronics_phones'),
  ('computers', 'electronics_computers'),
  ('computer', 'electronics_computers'),
  ('laptops', 'electronics_computers'),
  ('tablets', 'electronics_computers'),
  ('gaming', 'electronics_gaming'),
  ('games', 'electronics_gaming'),
  ('videogames', 'electronics_gaming'),
  ('consoles', 'electronics_gaming'),
  ('cameras', 'electronics_cameras'),
  ('camera', 'electronics_cameras'),
  ('photo', 'electronics_cameras'),
  ('audio', 'electronics_audio'),
  ('headphones', 'electronics_audio'),
  ('speakers', 'electronics_audio'),
  
  -- Clothing shortcuts
  ('men', 'clothing_men'),
  ('mens', 'clothing_men'),
  ('women', 'clothing_women'),
  ('womens', 'clothing_women'),
  ('shoes', 'clothing_shoes'),
  ('footwear', 'clothing_shoes'),
  ('sneakers', 'clothing_shoes'),
  ('bags', 'clothing_bags'),
  ('handbags', 'clothing_bags'),
  ('purses', 'clothing_bags'),
  
  -- Vehicle shortcuts
  ('cars', 'vehicles_cars_trucks'),
  ('car', 'vehicles_cars_trucks'),
  ('trucks', 'vehicles_cars_trucks'),
  ('truck', 'vehicles_cars_trucks'),
  ('cars_trucks', 'vehicles_cars_trucks'),
  ('autos', 'vehicles_cars_trucks'),
  ('automobiles', 'vehicles_cars_trucks'),
  ('motorcycles', 'vehicles_motorcycles'),
  ('motorcycle', 'vehicles_motorcycles'),
  ('bikes', 'vehicles_motorcycles'),
  ('motorbikes', 'vehicles_motorcycles'),
  ('powersports', 'vehicles_powersports'),
  ('atv', 'vehicles_powersports'),
  ('utv', 'vehicles_powersports'),
  ('quads', 'vehicles_powersports'),
  ('boats', 'vehicles_boats'),
  ('boat', 'vehicles_boats'),
  ('watercraft', 'vehicles_boats'),
  ('rvs', 'vehicles_rvs_campers'),
  ('rv', 'vehicles_rvs_campers'),
  ('campers', 'vehicles_rvs_campers'),
  ('rvs_campers', 'vehicles_rvs_campers'),
  ('motorhomes', 'vehicles_rvs_campers'),
  ('trailers', 'vehicles_trailers_other'),
  ('trailer', 'vehicles_trailers_other'),
  ('trailers_other', 'vehicles_trailers_other'),
  ('classic_cars', 'vehicles_classic_cars'),
  ('classics', 'vehicles_classic_cars'),
  ('vintage_cars', 'vehicles_classic_cars'),
  ('vehicle_parts', 'vehicles_parts_accessories'),
  ('auto_parts', 'vehicles_parts_accessories'),
  
  -- Tab aliases
  ('home', 'home_garden'),
  ('garden', 'home_garden'),
  ('clothing', 'clothing_shoes_accessories'),
  ('fashion', 'clothing_shoes_accessories'),
  ('apparel', 'clothing_shoes_accessories'),
  ('jewelry', 'jewelry_watches'),
  ('watches', 'jewelry_watches'),
  ('jewellery', 'jewelry_watches'),
  ('business', 'business_industrial'),
  ('industrial', 'business_industrial'),
  ('sporting', 'sporting_goods'),
  ('sports', 'sporting_goods'),
  ('fitness', 'sporting_goods'),
  ('parts', 'parts_accessories'),
  ('accessories', 'parts_accessories'),
  ('refurb', 'refurbished'),
  ('renewed', 'refurbished'),
  ('certified', 'refurbished')
ON CONFLICT (alias) DO UPDATE SET canonical_key = EXCLUDED.canonical_key;

-- 5) Update catalog_nav_subtabs with correct eBay category IDs
UPDATE public.catalog_nav_subtabs SET ebay_category_id = '9355' WHERE key = 'electronics_phones';
UPDATE public.catalog_nav_subtabs SET ebay_category_id = '58058' WHERE key = 'electronics_computers';
UPDATE public.catalog_nav_subtabs SET ebay_category_id = '1249' WHERE key = 'electronics_gaming';
UPDATE public.catalog_nav_subtabs SET ebay_category_id = '625' WHERE key = 'electronics_cameras';
UPDATE public.catalog_nav_subtabs SET ebay_category_id = '293' WHERE key = 'electronics_audio';
UPDATE public.catalog_nav_subtabs SET ebay_category_id = '6000' WHERE key = 'vehicles_all';
UPDATE public.catalog_nav_subtabs SET ebay_category_id = '6001' WHERE key = 'vehicles_cars_trucks';
UPDATE public.catalog_nav_subtabs SET ebay_category_id = '6024' WHERE key = 'vehicles_motorcycles';
UPDATE public.catalog_nav_subtabs SET ebay_category_id = '66466' WHERE key = 'vehicles_powersports';
UPDATE public.catalog_nav_subtabs SET ebay_category_id = '26429' WHERE key = 'vehicles_boats';
UPDATE public.catalog_nav_subtabs SET ebay_category_id = '50054' WHERE key = 'vehicles_rvs_campers';
UPDATE public.catalog_nav_subtabs SET ebay_category_id = '6038' WHERE key = 'vehicles_trailers_other';
UPDATE public.catalog_nav_subtabs SET ebay_category_id = '6001' WHERE key = 'vehicles_classic_cars';
UPDATE public.catalog_nav_subtabs SET ebay_category_id = '6028' WHERE key = 'vehicles_parts_accessories';
UPDATE public.catalog_nav_subtabs SET ebay_category_id = '1059' WHERE key = 'clothing_men';
UPDATE public.catalog_nav_subtabs SET ebay_category_id = '15724' WHERE key = 'clothing_women';
UPDATE public.catalog_nav_subtabs SET ebay_category_id = '63889' WHERE key = 'clothing_shoes';
UPDATE public.catalog_nav_subtabs SET ebay_category_id = '169291' WHERE key = 'clothing_bags';

-- 6) Update catalog_nav_tabs with correct eBay category IDs
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'catalog_nav_tabs' 
    AND column_name = 'ebay_category_id'
  ) THEN
    ALTER TABLE public.catalog_nav_tabs ADD COLUMN ebay_category_id text;
  END IF;
END $$;

UPDATE public.catalog_nav_tabs SET ebay_category_id = '293' WHERE key = 'electronics';
UPDATE public.catalog_nav_tabs SET ebay_category_id = '6000' WHERE key = 'vehicles';
UPDATE public.catalog_nav_tabs SET ebay_category_id = '11700' WHERE key = 'home_garden';
UPDATE public.catalog_nav_tabs SET ebay_category_id = '11450' WHERE key = 'clothing_shoes_accessories';
UPDATE public.catalog_nav_tabs SET ebay_category_id = '220' WHERE key = 'toys';
UPDATE public.catalog_nav_tabs SET ebay_category_id = '888' WHERE key = 'sporting_goods';
UPDATE public.catalog_nav_tabs SET ebay_category_id = '12576' WHERE key = 'business_industrial';
UPDATE public.catalog_nav_tabs SET ebay_category_id = '281' WHERE key = 'jewelry_watches';
UPDATE public.catalog_nav_tabs SET ebay_category_id = '6028' WHERE key = 'parts_accessories';

-- 7) Create function to clean expired facets cache
CREATE OR REPLACE FUNCTION public.cleanup_expired_facets_cache()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted_count integer;
BEGIN
  DELETE FROM public.catalog_facets_cache 
  WHERE expires_at < now();
  
  GET DIAGNOSTICS v_deleted_count = ROW_COUNT;
  
  RETURN jsonb_build_object(
    'success', true,
    'deleted_count', v_deleted_count,
    'cleanup_at', now()
  );
END;
$$;