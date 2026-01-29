-- Create catalog_nav_tabs table (single source of truth for top-level tabs)
CREATE TABLE public.catalog_nav_tabs (
  key TEXT PRIMARY KEY,
  title_en TEXT NOT NULL,
  title_fr TEXT NOT NULL,
  icon TEXT,
  order_index INTEGER NOT NULL DEFAULT 0,
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Create catalog_nav_subtabs table (subtabs/subfilters for each tab)
CREATE TABLE public.catalog_nav_subtabs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_key TEXT NOT NULL REFERENCES public.catalog_nav_tabs(key) ON DELETE CASCADE,
  key TEXT UNIQUE NOT NULL,
  title_en TEXT NOT NULL,
  title_fr TEXT NOT NULL,
  order_index INTEGER NOT NULL DEFAULT 0,
  enabled BOOLEAN NOT NULL DEFAULT true,
  provider_mode JSONB NOT NULL DEFAULT '{"ebay":"live","amazon":"db"}',
  ebay_category_hint TEXT,
  min_price_usd INTEGER,
  is_vehicle BOOLEAN NOT NULL DEFAULT false,
  is_parts BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Create ebay_category_cache for taxonomy resolution
CREATE TABLE public.ebay_category_cache (
  marketplace_id TEXT NOT NULL DEFAULT 'EBAY_US',
  hint TEXT NOT NULL,
  category_tree_id TEXT,
  category_id TEXT NOT NULL,
  category_name TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '7 days'),
  PRIMARY KEY (marketplace_id, hint)
);

-- Enable RLS
ALTER TABLE public.catalog_nav_tabs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.catalog_nav_subtabs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ebay_category_cache ENABLE ROW LEVEL SECURITY;

-- Public read access for nav tabs/subtabs (needed for frontend)
CREATE POLICY "Anyone can read nav tabs" ON public.catalog_nav_tabs
  FOR SELECT USING (true);

CREATE POLICY "Anyone can read nav subtabs" ON public.catalog_nav_subtabs
  FOR SELECT USING (true);

CREATE POLICY "Anyone can read category cache" ON public.ebay_category_cache
  FOR SELECT USING (true);

-- Admin write access
CREATE POLICY "Admins can manage nav tabs" ON public.catalog_nav_tabs
  FOR ALL USING (public.is_admin());

CREATE POLICY "Admins can manage nav subtabs" ON public.catalog_nav_subtabs
  FOR ALL USING (public.is_admin());

CREATE POLICY "System can manage category cache" ON public.ebay_category_cache
  FOR ALL USING (true);

-- Indexes
CREATE INDEX idx_catalog_nav_tabs_order ON public.catalog_nav_tabs(order_index);
CREATE INDEX idx_catalog_nav_subtabs_parent ON public.catalog_nav_subtabs(parent_key);
CREATE INDEX idx_catalog_nav_subtabs_order ON public.catalog_nav_subtabs(parent_key, order_index);
CREATE INDEX idx_ebay_category_cache_expires ON public.ebay_category_cache(expires_at);

-- Updated_at triggers
CREATE TRIGGER update_catalog_nav_tabs_updated_at
  BEFORE UPDATE ON public.catalog_nav_tabs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER update_catalog_nav_subtabs_updated_at
  BEFORE UPDATE ON public.catalog_nav_subtabs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Seed the tabs (single source of truth)
INSERT INTO public.catalog_nav_tabs (key, title_en, title_fr, icon, order_index) VALUES
  ('electronics', 'Electronics', 'Électronique', 'Smartphone', 1),
  ('vehicles', 'Vehicles', 'Véhicules', 'Car', 2),
  ('home_garden', 'Home & Garden', 'Maison & Jardin', 'Home', 3),
  ('clothing_shoes_accessories', 'Clothing, Shoes & Accessories', 'Vêtements, Chaussures & Accessoires', 'Shirt', 4),
  ('toys', 'Toys', 'Jouets', 'Gamepad2', 5),
  ('sporting_goods', 'Sporting Goods', 'Articles de Sport', 'Dumbbell', 6),
  ('business_industrial', 'Business & Industrial', 'Entreprise & Industrie', 'Building', 7),
  ('jewelry_watches', 'Jewelry & Watches', 'Bijoux & Montres', 'Watch', 8),
  ('refurbished', 'Refurbished', 'Reconditionné', 'RefreshCw', 9),
  ('parts_accessories', 'Parts & Accessories', 'Pièces & Accessoires', 'Wrench', 10);

-- Seed vehicle subtabs (with category hints for taxonomy resolution)
INSERT INTO public.catalog_nav_subtabs (parent_key, key, title_en, title_fr, order_index, ebay_category_hint, min_price_usd, is_vehicle, is_parts) VALUES
  ('vehicles', 'vehicles_all', 'All Vehicles', 'Tous les Véhicules', 0, 'Motors', 1500, true, false),
  ('vehicles', 'vehicles_cars_trucks', 'Cars & Trucks', 'Voitures & Camions', 1, 'Cars & Trucks', 1500, true, false),
  ('vehicles', 'vehicles_motorcycles', 'Motorcycles', 'Motos', 2, 'Motorcycles', 500, true, false),
  ('vehicles', 'vehicles_powersports', 'Powersports', 'Sports Motorisés', 3, 'Powersports', 500, true, false),
  ('vehicles', 'vehicles_boats', 'Boats', 'Bateaux', 4, 'Boats', 1000, true, false),
  ('vehicles', 'vehicles_rvs_campers', 'RVs & Campers', 'Camping-cars', 5, 'RVs & Campers', 2000, true, false),
  ('vehicles', 'vehicles_trailers_other', 'Trailers & Other Vehicles', 'Remorques & Autres', 6, 'Trailers & Other Vehicles', 500, true, false),
  ('vehicles', 'vehicles_classic_cars', 'Classic Cars', 'Voitures Classiques', 7, 'Classic Cars', 5000, true, false),
  ('vehicles', 'vehicles_parts_accessories', 'Parts & Accessories', 'Pièces & Accessoires', 8, 'Parts & Accessories', NULL, false, true);

-- Seed electronics subtabs
INSERT INTO public.catalog_nav_subtabs (parent_key, key, title_en, title_fr, order_index, ebay_category_hint) VALUES
  ('electronics', 'electronics_phones', 'Cell Phones & Smartphones', 'Téléphones', 1, 'Cell Phones & Smartphones'),
  ('electronics', 'electronics_computers', 'Computers & Tablets', 'Ordinateurs & Tablettes', 2, 'Computers/Tablets & Networking'),
  ('electronics', 'electronics_gaming', 'Video Games & Consoles', 'Jeux Vidéo & Consoles', 3, 'Video Games & Consoles'),
  ('electronics', 'electronics_cameras', 'Cameras & Photo', 'Appareils Photo', 4, 'Cameras & Photo'),
  ('electronics', 'electronics_audio', 'Audio Equipment', 'Équipement Audio', 5, 'Consumer Electronics');

-- Seed clothing subtabs
INSERT INTO public.catalog_nav_subtabs (parent_key, key, title_en, title_fr, order_index, ebay_category_hint) VALUES
  ('clothing_shoes_accessories', 'clothing_men', 'Men''s Clothing', 'Vêtements Homme', 1, 'Men''s Clothing'),
  ('clothing_shoes_accessories', 'clothing_women', 'Women''s Clothing', 'Vêtements Femme', 2, 'Women''s Clothing'),
  ('clothing_shoes_accessories', 'clothing_shoes', 'Shoes', 'Chaussures', 3, 'Shoes'),
  ('clothing_shoes_accessories', 'clothing_bags', 'Bags & Accessories', 'Sacs & Accessoires', 4, 'Bags & Accessories');

-- Seed known eBay category IDs (pre-cache for common categories)
INSERT INTO public.ebay_category_cache (marketplace_id, hint, category_id, category_name, category_tree_id) VALUES
  ('EBAY_US', 'Motors', '6000', 'eBay Motors', '0'),
  ('EBAY_US', 'Cars & Trucks', '6001', 'Cars & Trucks', '0'),
  ('EBAY_US', 'Motorcycles', '6024', 'Motorcycles', '0'),
  ('EBAY_US', 'Powersports', '66466', 'Powersports', '0'),
  ('EBAY_US', 'Boats', '26429', 'Boats', '0'),
  ('EBAY_US', 'RVs & Campers', '50054', 'RVs & Campers', '0'),
  ('EBAY_US', 'Trailers & Other Vehicles', '6038', 'Trailers & Other Vehicles', '0'),
  ('EBAY_US', 'Classic Cars', '6001', 'Classic Cars', '0'),
  ('EBAY_US', 'Parts & Accessories', '6028', 'Parts & Accessories', '0'),
  ('EBAY_US', 'Cell Phones & Smartphones', '9355', 'Cell Phones & Smartphones', '0'),
  ('EBAY_US', 'Computers/Tablets & Networking', '58058', 'Computers/Tablets & Networking', '0'),
  ('EBAY_US', 'Video Games & Consoles', '1249', 'Video Games & Consoles', '0'),
  ('EBAY_US', 'Cameras & Photo', '625', 'Cameras & Photo', '0'),
  ('EBAY_US', 'Consumer Electronics', '293', 'Consumer Electronics', '0'),
  ('EBAY_US', 'Men''s Clothing', '1059', 'Men''s Clothing', '0'),
  ('EBAY_US', 'Women''s Clothing', '15724', 'Women''s Clothing', '0'),
  ('EBAY_US', 'Shoes', '63889', 'Shoes', '0'),
  ('EBAY_US', 'Bags & Accessories', '169291', 'Bags & Accessories', '0'),
  ('EBAY_US', 'Home & Garden', '11700', 'Home & Garden', '0'),
  ('EBAY_US', 'Toys & Hobbies', '220', 'Toys & Hobbies', '0'),
  ('EBAY_US', 'Sporting Goods', '888', 'Sporting Goods', '0'),
  ('EBAY_US', 'Business & Industrial', '12576', 'Business & Industrial', '0'),
  ('EBAY_US', 'Jewelry & Watches', '281', 'Jewelry & Watches', '0')
ON CONFLICT (marketplace_id, hint) DO UPDATE SET
  category_id = EXCLUDED.category_id,
  category_name = EXCLUDED.category_name,
  updated_at = now(),
  expires_at = now() + interval '7 days';