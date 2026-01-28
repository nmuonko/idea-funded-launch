-- 1) Create catalog_items table if not exists
CREATE TABLE IF NOT EXISTS public.catalog_items (
  id text PRIMARY KEY,
  provider text,
  provider_product_id text,
  title text,
  price_usd numeric,
  image_url text,
  images jsonb DEFAULT '[]'::jsonb,
  product_url text,
  in_stock boolean,
  rating numeric,
  category text,
  tags text[] DEFAULT '{}',
  search_text text,
  updated_at timestamptz DEFAULT now()
);

-- 2) Create catalog_collections table if not exists
CREATE TABLE IF NOT EXISTS public.catalog_collections (
  slug text PRIMARY KEY,
  title text,
  description text,
  priority int DEFAULT 100,
  item_ids text[] DEFAULT '{}',
  updated_at timestamptz DEFAULT now()
);

-- 3) Create catalog_refresh_jobs table if not exists
CREATE TABLE IF NOT EXISTS public.catalog_refresh_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text,
  status text DEFAULT 'pending',
  last_run timestamptz,
  last_error text,
  created_at timestamptz DEFAULT now()
);

-- 4) Create catalog_cache_settings table for configurable TTLs
CREATE TABLE IF NOT EXISTS public.catalog_cache_settings (
  key text PRIMARY KEY DEFAULT 'default',
  home_stale_minutes int DEFAULT 180,
  home_expires_minutes int DEFAULT 1440,
  search_stale_minutes int DEFAULT 240,
  search_expires_minutes int DEFAULT 2880,
  offers_stale_minutes int DEFAULT 180,
  offers_expires_minutes int DEFAULT 720,
  negative_expires_seconds int DEFAULT 120,
  updated_at timestamptz DEFAULT now()
);

-- Insert default cache settings
INSERT INTO public.catalog_cache_settings (key) VALUES ('default')
ON CONFLICT (key) DO NOTHING;

-- Insert default collections
INSERT INTO public.catalog_collections (slug, title, description, priority) VALUES
  ('trending_electronics', 'Trending Electronics', 'Top electronics across all categories', 1),
  ('phones', 'Phones', 'Cell phones and smartphones', 10),
  ('tablets', 'Tablets', 'Tablets and e-readers', 20),
  ('computers', 'Computers', 'Laptops and desktops', 30),
  ('monitors', 'Monitors', 'Computer monitors and displays', 40),
  ('audio', 'Audio', 'Headphones, earbuds, and speakers', 50),
  ('gaming', 'Gaming', 'Gaming consoles and accessories', 60),
  ('accessories', 'Accessories', 'Phone and computer accessories', 70),
  ('vehicles', 'Vehicles', 'Cars, motorcycles, and parts', 100)
ON CONFLICT (slug) DO NOTHING;

-- Create trigram extension for fast text search
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Create trigram index for catalog_items search
CREATE INDEX IF NOT EXISTS idx_catalog_items_search_text_trgm 
  ON public.catalog_items USING gin (search_text gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_catalog_items_category 
  ON public.catalog_items (category);

CREATE INDEX IF NOT EXISTS idx_catalog_items_updated_at 
  ON public.catalog_items (updated_at DESC);

-- Function to auto-generate search_text
CREATE OR REPLACE FUNCTION public.generate_catalog_search_text()
RETURNS TRIGGER AS $$
BEGIN
  NEW.search_text = lower(
    COALESCE(NEW.title, '') || ' ' ||
    COALESCE(array_to_string(NEW.tags, ' '), '') || ' ' ||
    COALESCE(NEW.category, '') || ' ' ||
    COALESCE(NEW.provider, '')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS generate_catalog_search_text_trigger ON public.catalog_items;
CREATE TRIGGER generate_catalog_search_text_trigger
  BEFORE INSERT OR UPDATE ON public.catalog_items
  FOR EACH ROW EXECUTE FUNCTION public.generate_catalog_search_text();

-- Update trigger for catalog_cache_settings
CREATE OR REPLACE FUNCTION public.update_catalog_cache_settings_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS update_catalog_cache_settings_updated_at ON public.catalog_cache_settings;
CREATE TRIGGER update_catalog_cache_settings_updated_at
  BEFORE UPDATE ON public.catalog_cache_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_catalog_cache_settings_updated_at();

-- RLS Policies
ALTER TABLE public.catalog_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.catalog_collections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.catalog_refresh_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.catalog_cache_settings ENABLE ROW LEVEL SECURITY;

-- catalog_items: public read
DROP POLICY IF EXISTS "Anyone can read catalog items" ON public.catalog_items;
CREATE POLICY "Anyone can read catalog items"
  ON public.catalog_items FOR SELECT USING (true);

DROP POLICY IF EXISTS "Service role can manage catalog items" ON public.catalog_items;
CREATE POLICY "Service role can manage catalog items"
  ON public.catalog_items FOR ALL TO service_role USING (true) WITH CHECK (true);

-- catalog_collections: public read
DROP POLICY IF EXISTS "Anyone can read collections" ON public.catalog_collections;
CREATE POLICY "Anyone can read collections"
  ON public.catalog_collections FOR SELECT USING (true);

DROP POLICY IF EXISTS "Service role can manage collections" ON public.catalog_collections;
CREATE POLICY "Service role can manage collections"
  ON public.catalog_collections FOR ALL TO service_role USING (true) WITH CHECK (true);

-- catalog_refresh_jobs: admin only
DROP POLICY IF EXISTS "Admins can read refresh jobs" ON public.catalog_refresh_jobs;
CREATE POLICY "Admins can read refresh jobs"
  ON public.catalog_refresh_jobs FOR SELECT TO authenticated
  USING (public.is_admin());

DROP POLICY IF EXISTS "Service role can manage refresh jobs" ON public.catalog_refresh_jobs;
CREATE POLICY "Service role can manage refresh jobs"
  ON public.catalog_refresh_jobs FOR ALL TO service_role USING (true) WITH CHECK (true);

-- catalog_cache_settings: public read, admin write
DROP POLICY IF EXISTS "Anyone can read cache settings" ON public.catalog_cache_settings;
CREATE POLICY "Anyone can read cache settings"
  ON public.catalog_cache_settings FOR SELECT USING (true);

DROP POLICY IF EXISTS "Admins can modify cache settings" ON public.catalog_cache_settings;
CREATE POLICY "Admins can modify cache settings"
  ON public.catalog_cache_settings FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Service role can manage cache settings" ON public.catalog_cache_settings;
CREATE POLICY "Service role can manage cache settings"
  ON public.catalog_cache_settings FOR ALL TO service_role USING (true) WITH CHECK (true);