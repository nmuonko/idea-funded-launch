
-- =============================================
-- HOME RECIPES: Unified curation system
-- =============================================

-- 1) home_recipes
CREATE TABLE public.home_recipes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target text NOT NULL CHECK (target IN ('mobile', 'web')),
  key text NOT NULL,
  title_en text,
  title_fr text,
  enabled boolean NOT NULL DEFAULT true,
  sort_order int NOT NULL DEFAULT 0,
  mode text NOT NULL DEFAULT 'manual' CHECK (mode IN ('manual', 'auto')),
  min_price_usd numeric,
  max_price_usd numeric,
  provider_policy jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (target, key)
);

ALTER TABLE public.home_recipes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_all_home_recipes" ON public.home_recipes
  FOR ALL USING (public.is_admin_role())
  WITH CHECK (public.is_admin_role());

-- updated_at trigger
CREATE TRIGGER update_home_recipes_updated_at
  BEFORE UPDATE ON public.home_recipes
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 2) home_recipe_seeds
CREATE TABLE public.home_recipe_seeds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipe_id uuid NOT NULL REFERENCES public.home_recipes(id) ON DELETE CASCADE,
  query text NOT NULL,
  weight int NOT NULL DEFAULT 1,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_home_recipe_seeds_recipe ON public.home_recipe_seeds(recipe_id, enabled);

ALTER TABLE public.home_recipe_seeds ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_all_home_recipe_seeds" ON public.home_recipe_seeds
  FOR ALL USING (public.is_admin_role())
  WITH CHECK (public.is_admin_role());

-- 3) home_cache_mobile_sections (new dedicated cache)
CREATE TABLE public.home_cache_mobile_sections (
  env text NOT NULL PRIMARY KEY,
  schema_version int NOT NULL,
  built_at timestamptz NOT NULL DEFAULT now(),
  ttl_seconds int NOT NULL,
  payload jsonb NOT NULL
);

ALTER TABLE public.home_cache_mobile_sections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public_read_home_cache_mobile" ON public.home_cache_mobile_sections
  FOR SELECT USING (true);

CREATE POLICY "admin_write_home_cache_mobile" ON public.home_cache_mobile_sections
  FOR ALL USING (public.is_admin_role())
  WITH CHECK (public.is_admin_role());

-- Service role needs to write too (edge functions)
CREATE POLICY "service_write_home_cache_mobile" ON public.home_cache_mobile_sections
  FOR ALL USING (
    (current_setting('request.jwt.claims', true)::jsonb ->> 'role') = 'service_role'
  );

-- 4) home_cache_web_feed
CREATE TABLE public.home_cache_web_feed (
  env text NOT NULL PRIMARY KEY,
  schema_version int NOT NULL,
  built_at timestamptz NOT NULL DEFAULT now(),
  ttl_seconds int NOT NULL,
  payload jsonb NOT NULL
);

ALTER TABLE public.home_cache_web_feed ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public_read_home_cache_web" ON public.home_cache_web_feed
  FOR SELECT USING (true);

CREATE POLICY "admin_write_home_cache_web" ON public.home_cache_web_feed
  FOR ALL USING (public.is_admin_role())
  WITH CHECK (public.is_admin_role());

CREATE POLICY "service_write_home_cache_web" ON public.home_cache_web_feed
  FOR ALL USING (
    (current_setting('request.jwt.claims', true)::jsonb ->> 'role') = 'service_role'
  );

-- 5) home_refresh_settings
CREATE TABLE public.home_refresh_settings (
  env text NOT NULL PRIMARY KEY,
  mobile_refresh_hours int NOT NULL DEFAULT 12,
  web_refresh_hours int NOT NULL DEFAULT 12,
  mobile_enabled boolean NOT NULL DEFAULT true,
  web_enabled boolean NOT NULL DEFAULT true,
  mobile_schema_version int NOT NULL DEFAULT 1,
  web_schema_version int NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.home_refresh_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_all_home_refresh_settings" ON public.home_refresh_settings
  FOR ALL USING (public.is_admin_role())
  WITH CHECK (public.is_admin_role());

CREATE POLICY "service_read_home_refresh_settings" ON public.home_refresh_settings
  FOR SELECT USING (
    (current_setting('request.jwt.claims', true)::jsonb ->> 'role') = 'service_role'
  );

CREATE TRIGGER update_home_refresh_settings_updated_at
  BEFORE UPDATE ON public.home_refresh_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =============================================
-- SEED DATA
-- =============================================

-- Default refresh settings
INSERT INTO public.home_refresh_settings (env, mobile_refresh_hours, web_refresh_hours)
VALUES ('production', 12, 12)
ON CONFLICT (env) DO NOTHING;

-- MOBILE RECIPES (10 sections)
INSERT INTO public.home_recipes (target, key, title_en, title_fr, sort_order, provider_policy) VALUES
  ('mobile', 'phones', 'Phones', 'Téléphones', 0, '{"amazon":true,"ebay":true}'),
  ('mobile', 'electronics', 'Electronics', 'Électronique', 1, '{"amazon":true,"ebay":true}'),
  ('mobile', 'vehicles', 'Vehicles', 'Véhicules', 2, '{"amazon":false,"ebay":true}'),
  ('mobile', 'gaming', 'Gaming', 'Jeux Vidéo', 3, '{"amazon":true,"ebay":true}'),
  ('mobile', 'clothing', 'Clothing & Fashion', 'Vêtements et Mode', 4, '{"amazon":true,"ebay":true}'),
  ('mobile', 'home_garden', 'Home & Garden', 'Maison & Jardin', 5, '{"amazon":true,"ebay":true}'),
  ('mobile', 'toys', 'Toys', 'Jouets', 6, '{"amazon":true,"ebay":true}'),
  ('mobile', 'sporting_goods', 'Sporting Goods', 'Articles de Sport', 7, '{"amazon":true,"ebay":true}'),
  ('mobile', 'refurbished', 'Refurbished', 'Reconditionnés', 8, '{"amazon":true,"ebay":true}'),
  ('mobile', 'parts_accessories', 'Parts & Accessories', 'Pièces & Accessoires', 9, '{"amazon":true,"ebay":true}')
ON CONFLICT (target, key) DO NOTHING;

-- Update vehicles min price
UPDATE public.home_recipes SET min_price_usd = 1500 WHERE target = 'mobile' AND key = 'vehicles';

-- WEB RECIPES (10 pages)
INSERT INTO public.home_recipes (target, key, title_en, title_fr, sort_order, provider_policy) VALUES
  ('web', 'page_1', 'Best Sellers', 'Meilleures Ventes', 0, '{"amazon":true,"ebay":true}'),
  ('web', 'page_2', 'Page 2', 'Page 2', 1, '{"amazon":true,"ebay":true}'),
  ('web', 'page_3', 'Page 3', 'Page 3', 2, '{"amazon":true,"ebay":true}'),
  ('web', 'page_4', 'Page 4', 'Page 4', 3, '{"amazon":true,"ebay":true}'),
  ('web', 'page_5', 'Page 5', 'Page 5', 4, '{"amazon":true,"ebay":true}'),
  ('web', 'page_6', 'Page 6', 'Page 6', 5, '{"amazon":true,"ebay":true}'),
  ('web', 'page_7', 'Page 7', 'Page 7', 6, '{"amazon":true,"ebay":true}'),
  ('web', 'page_8', 'Page 8', 'Page 8', 7, '{"amazon":true,"ebay":true}'),
  ('web', 'page_9', 'Page 9', 'Page 9', 8, '{"amazon":true,"ebay":true}'),
  ('web', 'page_10', 'Page 10', 'Page 10', 9, '{"amazon":true,"ebay":true}')
ON CONFLICT (target, key) DO NOTHING;

-- MOBILE SEEDS
-- phones
WITH r AS (SELECT id FROM public.home_recipes WHERE target='mobile' AND key='phones')
INSERT INTO public.home_recipe_seeds (recipe_id, query, weight) SELECT r.id, q, 1 FROM r, unnest(ARRAY[
  'iPhone unlocked','iPhone 14 unlocked','iPhone 15 unlocked','Samsung Galaxy unlocked',
  'Google Pixel unlocked','iPhone refurbished','Samsung Galaxy S24','iPhone 13 Pro',
  'Android phone unlocked','iPhone Pro Max'
]) AS q;

-- electronics
WITH r AS (SELECT id FROM public.home_recipes WHERE target='mobile' AND key='electronics')
INSERT INTO public.home_recipe_seeds (recipe_id, query, weight) SELECT r.id, q, 1 FROM r, unnest(ARRAY[
  'laptop','tablet','smart TV','headphones wireless','monitor 4K','camera DSLR',
  'bluetooth speaker','wireless earbuds','MacBook','iPad','smartwatch'
]) AS q;

-- vehicles
WITH r AS (SELECT id FROM public.home_recipes WHERE target='mobile' AND key='vehicles')
INSERT INTO public.home_recipe_seeds (recipe_id, query, weight) SELECT r.id, q, 1 FROM r, unnest(ARRAY[
  'SUV for sale','Toyota RAV4','Honda CR-V','Chevrolet Tahoe','GMC Yukon',
  'Ford Explorer','used SUV','Toyota Camry','Honda Civic','BMW X5'
]) AS q;

-- gaming
WITH r AS (SELECT id FROM public.home_recipes WHERE target='mobile' AND key='gaming')
INSERT INTO public.home_recipe_seeds (recipe_id, query, weight) SELECT r.id, q, 1 FROM r, unnest(ARRAY[
  'Xbox Series X','PS5 console','Nintendo Switch','Xbox games','PlayStation games',
  'gaming laptop','gaming headset','PS5 controller','Steam Deck','gaming keyboard'
]) AS q;

-- clothing
WITH r AS (SELECT id FROM public.home_recipes WHERE target='mobile' AND key='clothing')
INSERT INTO public.home_recipe_seeds (recipe_id, query, weight) SELECT r.id, q, 1 FROM r, unnest(ARRAY[
  'men shoes','women shoes','hoodie','sneakers Nike','jacket','dress',
  'Jordan shoes','Adidas sneakers','jeans','running shoes'
]) AS q;

-- home_garden
WITH r AS (SELECT id FROM public.home_recipes WHERE target='mobile' AND key='home_garden')
INSERT INTO public.home_recipe_seeds (recipe_id, query, weight) SELECT r.id, q, 1 FROM r, unnest(ARRAY[
  'sofa','mattress queen','dining table','office chair','kitchen appliance',
  'vacuum cleaner','air fryer','coffee maker','bed frame','microwave'
]) AS q;

-- toys
WITH r AS (SELECT id FROM public.home_recipes WHERE target='mobile' AND key='toys')
INSERT INTO public.home_recipe_seeds (recipe_id, query, weight) SELECT r.id, q, 1 FROM r, unnest(ARRAY[
  'lego set','kids toy','remote control car','Barbie doll','action figure',
  'board game','puzzle kids'
]) AS q;

-- sporting_goods
WITH r AS (SELECT id FROM public.home_recipes WHERE target='mobile' AND key='sporting_goods')
INSERT INTO public.home_recipe_seeds (recipe_id, query, weight) SELECT r.id, q, 1 FROM r, unnest(ARRAY[
  'soccer cleats','basketball','gym equipment','treadmill','yoga mat',
  'dumbbells','running shoes men','fitness tracker','camping tent'
]) AS q;

-- refurbished
WITH r AS (SELECT id FROM public.home_recipes WHERE target='mobile' AND key='refurbished')
INSERT INTO public.home_recipe_seeds (recipe_id, query, weight) SELECT r.id, q, 1 FROM r, unnest(ARRAY[
  'refurbished iPhone','renewed laptop','renewed headphones','certified refurbished',
  'refurbished iPad','refurbished MacBook','open box deals'
]) AS q;

-- parts_accessories
WITH r AS (SELECT id FROM public.home_recipes WHERE target='mobile' AND key='parts_accessories')
INSERT INTO public.home_recipe_seeds (recipe_id, query, weight) SELECT r.id, q, 1 FROM r, unnest(ARRAY[
  'car parts','auto accessories','phone case','charger USB-C','screen protector',
  'brake pads','headlight bulb','car battery','oil filter'
]) AS q;

-- WEB SEEDS
-- page_1 (best sellers)
WITH r AS (SELECT id FROM public.home_recipes WHERE target='web' AND key='page_1')
INSERT INTO public.home_recipe_seeds (recipe_id, query, weight) SELECT r.id, q, 1 FROM r, unnest(ARRAY[
  'iPhone unlocked','Samsung Galaxy','PS5 console','Nike shoes','MacBook Air',
  'AirPods Pro','gaming laptop','SUV for sale','smart TV 55','wireless earbuds'
]) AS q;

-- page_2
WITH r AS (SELECT id FROM public.home_recipes WHERE target='web' AND key='page_2')
INSERT INTO public.home_recipe_seeds (recipe_id, query, weight) SELECT r.id, q, 1 FROM r, unnest(ARRAY[
  'laptop deals','tablet Android','bluetooth speaker','camera lens','monitor 27 inch',
  'keyboard mechanical','mouse wireless','USB hub','SSD 1TB','webcam HD'
]) AS q;

-- page_3
WITH r AS (SELECT id FROM public.home_recipes WHERE target='web' AND key='page_3')
INSERT INTO public.home_recipe_seeds (recipe_id, query, weight) SELECT r.id, q, 1 FROM r, unnest(ARRAY[
  'sofa living room','mattress memory foam','office chair ergonomic','dining set','vacuum robot',
  'air purifier','coffee machine','kitchen gadgets','desk lamp','bookshelf'
]) AS q;

-- page_4
WITH r AS (SELECT id FROM public.home_recipes WHERE target='web' AND key='page_4')
INSERT INTO public.home_recipe_seeds (recipe_id, query, weight) SELECT r.id, q, 1 FROM r, unnest(ARRAY[
  'men sneakers','women boots','hoodie zip','jacket winter','backpack travel',
  'sunglasses polarized','watch men','jewelry women','handbag leather','belt men'
]) AS q;

-- page_5
WITH r AS (SELECT id FROM public.home_recipes WHERE target='web' AND key='page_5')
INSERT INTO public.home_recipe_seeds (recipe_id, query, weight) SELECT r.id, q, 1 FROM r, unnest(ARRAY[
  'Xbox games','Nintendo Switch games','gaming headset','gaming chair','PS5 controller',
  'gaming monitor','VR headset','gaming mouse pad','streaming microphone','capture card'
]) AS q;

-- page_6
WITH r AS (SELECT id FROM public.home_recipes WHERE target='web' AND key='page_6')
INSERT INTO public.home_recipe_seeds (recipe_id, query, weight) SELECT r.id, q, 1 FROM r, unnest(ARRAY[
  'Toyota parts','Honda accessories','car stereo','dash cam','car charger',
  'LED headlights','brake pads','car cover','floor mats','jump starter'
]) AS q;

-- page_7
WITH r AS (SELECT id FROM public.home_recipes WHERE target='web' AND key='page_7')
INSERT INTO public.home_recipe_seeds (recipe_id, query, weight) SELECT r.id, q, 1 FROM r, unnest(ARRAY[
  'lego city','action figures','remote control drone','board game family','puzzle 1000 pieces',
  'kids bicycle','plush toy','science kit','art supplies','toy train'
]) AS q;

-- page_8
WITH r AS (SELECT id FROM public.home_recipes WHERE target='web' AND key='page_8')
INSERT INTO public.home_recipe_seeds (recipe_id, query, weight) SELECT r.id, q, 1 FROM r, unnest(ARRAY[
  'treadmill folding','dumbbells adjustable','yoga mat thick','resistance bands','exercise bike',
  'boxing gloves','soccer ball','tennis racket','camping gear','fishing rod'
]) AS q;

-- page_9
WITH r AS (SELECT id FROM public.home_recipes WHERE target='web' AND key='page_9')
INSERT INTO public.home_recipe_seeds (recipe_id, query, weight) SELECT r.id, q, 1 FROM r, unnest(ARRAY[
  'refurbished iPhone 13','renewed MacBook Pro','open box laptop','certified refurbished TV',
  'refurbished iPad Air','renewed AirPods','refurbished Samsung Galaxy','open box monitor',
  'renewed gaming console','refurbished Apple Watch'
]) AS q;

-- page_10
WITH r AS (SELECT id FROM public.home_recipes WHERE target='web' AND key='page_10')
INSERT INTO public.home_recipe_seeds (recipe_id, query, weight) SELECT r.id, q, 1 FROM r, unnest(ARRAY[
  'smart home devices','robot vacuum','air fryer large','instant pot','blender smoothie',
  'electric toothbrush','hair dryer','skin care set','essential oils','water bottle insulated'
]) AS q;
