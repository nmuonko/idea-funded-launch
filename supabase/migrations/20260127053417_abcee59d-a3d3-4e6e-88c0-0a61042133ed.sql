-- =====================================================
-- NATIVE PRODUCT CATALOG SYSTEM
-- Environments, Providers, Products, Categories
-- =====================================================

-- 1. ENVIRONMENTS TABLE
-- Controls feature flags and environment-specific config
CREATE TABLE IF NOT EXISTS public.environments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE CHECK (name IN ('production', 'staging')),
  is_default BOOLEAN DEFAULT false,
  catalog_enabled BOOLEAN DEFAULT false,
  catalog_mode TEXT DEFAULT 'webview' CHECK (catalog_mode IN ('webview', 'native', 'hybrid')),
  api_base_url TEXT DEFAULT '',
  provider_secrets_prefix TEXT DEFAULT '',
  min_app_version TEXT DEFAULT '1.0.0',
  ota_enabled BOOLEAN DEFAULT true,
  ota_channel TEXT DEFAULT 'production',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.environments ENABLE ROW LEVEL SECURITY;

-- RLS: Public can read environments (needed for config)
CREATE POLICY "Anyone can read environments"
  ON public.environments FOR SELECT
  USING (true);

-- RLS: Only admins can manage environments
CREATE POLICY "Admins can manage environments"
  ON public.environments FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- Insert default environments
INSERT INTO public.environments (name, is_default, catalog_enabled, catalog_mode, api_base_url, ota_channel)
VALUES 
  ('production', true, false, 'webview', '', 'production'),
  ('staging', false, true, 'native', 'https://igmkhxffnyzoogcqvdab.supabase.co/functions/v1', 'staging')
ON CONFLICT (name) DO NOTHING;

-- 2. CATALOG_PROVIDERS TABLE
-- Registered product API providers
CREATE TABLE IF NOT EXISTS public.catalog_providers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  enabled BOOLEAN DEFAULT false,
  priority INTEGER DEFAULT 50,
  config JSONB DEFAULT '{}',
  rate_limit_per_minute INTEGER DEFAULT 60,
  environment TEXT DEFAULT 'all' CHECK (environment IN ('production', 'staging', 'all')),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.catalog_providers ENABLE ROW LEVEL SECURITY;

-- RLS: Public can read enabled providers
CREATE POLICY "Anyone can read enabled providers"
  ON public.catalog_providers FOR SELECT
  USING (enabled = true);

-- RLS: Admins can manage all providers
CREATE POLICY "Admins can manage providers"
  ON public.catalog_providers FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- 3. CATALOG_CATEGORIES TABLE
-- Category tree per provider
CREATE TABLE IF NOT EXISTS public.catalog_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id UUID REFERENCES public.catalog_providers(id) ON DELETE CASCADE,
  external_id TEXT,
  name TEXT NOT NULL,
  parent_id UUID REFERENCES public.catalog_categories(id) ON DELETE SET NULL,
  icon_url TEXT,
  priority INTEGER DEFAULT 50,
  enabled BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.catalog_categories ENABLE ROW LEVEL SECURITY;

-- RLS: Public can read enabled categories
CREATE POLICY "Anyone can read enabled categories"
  ON public.catalog_categories FOR SELECT
  USING (enabled = true);

-- RLS: Admins can manage categories
CREATE POLICY "Admins can manage categories"
  ON public.catalog_categories FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- 4. CATALOG_PRODUCTS TABLE
-- Normalized product cache
CREATE TABLE IF NOT EXISTS public.catalog_products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id UUID REFERENCES public.catalog_providers(id) ON DELETE CASCADE,
  provider_product_id TEXT NOT NULL,
  title TEXT,
  brand TEXT,
  description TEXT,
  image_url TEXT,
  product_url TEXT,
  price_usd NUMERIC(12,2),
  currency TEXT DEFAULT 'USD',
  in_stock BOOLEAN DEFAULT true,
  category_path TEXT[],
  rating NUMERIC(3,2),
  review_count INTEGER,
  raw JSONB,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  expires_at TIMESTAMPTZ DEFAULT (now() + interval '4 hours'),
  UNIQUE(provider_id, provider_product_id)
);

-- Enable RLS
ALTER TABLE public.catalog_products ENABLE ROW LEVEL SECURITY;

-- RLS: Public can read products
CREATE POLICY "Anyone can read products"
  ON public.catalog_products FOR SELECT
  USING (true);

-- RLS: Service role can manage products (for cache updates)
CREATE POLICY "Service role can manage products"
  ON public.catalog_products FOR ALL
  USING (true)
  WITH CHECK (true);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_catalog_products_provider ON public.catalog_products(provider_id);
CREATE INDEX IF NOT EXISTS idx_catalog_products_expires ON public.catalog_products(expires_at);
CREATE INDEX IF NOT EXISTS idx_catalog_products_title_search ON public.catalog_products USING gin(to_tsvector('english', COALESCE(title, '') || ' ' || COALESCE(brand, '')));

-- Trigger for updated_at
CREATE OR REPLACE FUNCTION public.update_catalog_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_environments_updated_at
  BEFORE UPDATE ON public.environments
  FOR EACH ROW EXECUTE FUNCTION public.update_catalog_updated_at();

CREATE TRIGGER update_catalog_providers_updated_at
  BEFORE UPDATE ON public.catalog_providers
  FOR EACH ROW EXECUTE FUNCTION public.update_catalog_updated_at();

CREATE TRIGGER update_catalog_products_updated_at
  BEFORE UPDATE ON public.catalog_products
  FOR EACH ROW EXECUTE FUNCTION public.update_catalog_updated_at();