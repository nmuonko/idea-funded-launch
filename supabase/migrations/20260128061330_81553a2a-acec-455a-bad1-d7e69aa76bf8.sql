-- Tesla-style Navigation Config: Backend-driven catalog navigation

-- 1) Add missing columns to catalog_providers (already has some columns)
ALTER TABLE public.catalog_providers 
ADD COLUMN IF NOT EXISTS secret_key_name text DEFAULT NULL;

-- 2) Recreate catalog_categories with proper schema
-- First, drop constraints and recreate with slug-based primary key
DROP TABLE IF EXISTS public.catalog_categories CASCADE;

CREATE TABLE public.catalog_categories (
  slug text PRIMARY KEY,
  title text NOT NULL,
  group_title text NOT NULL DEFAULT 'Electronics',
  enabled boolean NOT NULL DEFAULT true,
  priority integer NOT NULL DEFAULT 100,
  provider_scope text NOT NULL DEFAULT 'all',
  queries jsonb NOT NULL DEFAULT '[]'::jsonb,
  icon text DEFAULT NULL,
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.catalog_categories ENABLE ROW LEVEL SECURITY;

-- Public read access
CREATE POLICY "Public can read enabled categories"
  ON public.catalog_categories FOR SELECT
  USING (true);

-- Admin can manage
CREATE POLICY "Admins can manage categories"
  ON public.catalog_categories FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- Create index for priority sorting
CREATE INDEX idx_catalog_categories_priority ON public.catalog_categories(group_title, priority DESC);

-- 3) Create catalog_nav_settings table
CREATE TABLE IF NOT EXISTS public.catalog_nav_settings (
  key text PRIMARY KEY DEFAULT 'default',
  home_sections jsonb NOT NULL DEFAULT '[]'::jsonb,
  drawer_order jsonb NOT NULL DEFAULT '[]'::jsonb,
  version integer NOT NULL DEFAULT 1,
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.catalog_nav_settings ENABLE ROW LEVEL SECURITY;

-- Public read access
CREATE POLICY "Public can read nav settings"
  ON public.catalog_nav_settings FOR SELECT
  USING (true);

-- Admin can manage
CREATE POLICY "Admins can manage nav settings"
  ON public.catalog_nav_settings FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- 4) Create view for public provider info (hide secret details)
CREATE OR REPLACE VIEW public.catalog_providers_public AS
SELECT 
  id,
  name,
  display_name,
  enabled,
  priority,
  logo_url,
  color_hex,
  capabilities,
  adapter_name,
  environment,
  updated_at
FROM public.catalog_providers;

-- Grant access to view
GRANT SELECT ON public.catalog_providers_public TO anon, authenticated;

-- 5) Auto-update timestamp trigger for categories
CREATE OR REPLACE FUNCTION public.update_catalog_categories_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER update_catalog_categories_updated_at
  BEFORE UPDATE ON public.catalog_categories
  FOR EACH ROW
  EXECUTE FUNCTION public.update_catalog_categories_updated_at();

-- 6) Auto-update timestamp trigger for nav settings
CREATE OR REPLACE FUNCTION public.update_catalog_nav_settings_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  NEW.version = OLD.version + 1;
  RETURN NEW;
END;
$$;

CREATE TRIGGER update_catalog_nav_settings_updated_at
  BEFORE UPDATE ON public.catalog_nav_settings
  FOR EACH ROW
  EXECUTE FUNCTION public.update_catalog_nav_settings_updated_at();