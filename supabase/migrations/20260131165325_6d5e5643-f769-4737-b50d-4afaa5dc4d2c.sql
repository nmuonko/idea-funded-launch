-- =====================================================================
-- Admin-Curated Homepage Schema
-- Tables: home_sections, home_section_seeds, home_seed_suggestions
-- =====================================================================

-- 1. home_sections - Section configuration for homepage
CREATE TABLE public.home_sections (
  key text PRIMARY KEY,
  title_en text NOT NULL,
  title_fr text NOT NULL,
  enabled boolean DEFAULT true,
  sort_order integer DEFAULT 0,
  default_category_key text,
  ebay_category text,
  is_vehicle boolean DEFAULT false,
  min_price numeric DEFAULT 0,
  see_all_query text,
  updated_at timestamptz DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.home_sections ENABLE ROW LEVEL SECURITY;

-- RLS policies (admin only)
CREATE POLICY "Admins can view home_sections"
ON public.home_sections FOR SELECT
TO authenticated
USING (public.is_admin_role());

CREATE POLICY "Admins can manage home_sections"
ON public.home_sections FOR ALL
TO authenticated
USING (public.is_admin_role())
WITH CHECK (public.is_admin_role());

-- Service role bypass for edge functions
CREATE POLICY "Service role bypass home_sections"
ON public.home_sections FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- Trigger for updated_at
CREATE TRIGGER update_home_sections_updated_at
BEFORE UPDATE ON public.home_sections
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

-- 2. home_section_seeds - Active seed queries for each section
CREATE TABLE public.home_section_seeds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  section_key text NOT NULL REFERENCES public.home_sections(key) ON DELETE CASCADE,
  query text NOT NULL,
  enabled boolean DEFAULT true,
  weight integer DEFAULT 100,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Indexes
CREATE INDEX idx_home_section_seeds_section_enabled ON public.home_section_seeds(section_key, enabled);
CREATE INDEX idx_home_section_seeds_section_weight ON public.home_section_seeds(section_key, weight DESC);

-- Enable RLS
ALTER TABLE public.home_section_seeds ENABLE ROW LEVEL SECURITY;

-- RLS policies (admin only)
CREATE POLICY "Admins can view home_section_seeds"
ON public.home_section_seeds FOR SELECT
TO authenticated
USING (public.is_admin_role());

CREATE POLICY "Admins can manage home_section_seeds"
ON public.home_section_seeds FOR ALL
TO authenticated
USING (public.is_admin_role())
WITH CHECK (public.is_admin_role());

-- Service role bypass for edge functions
CREATE POLICY "Service role bypass home_section_seeds"
ON public.home_section_seeds FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- Trigger for updated_at
CREATE TRIGGER update_home_section_seeds_updated_at
BEFORE UPDATE ON public.home_section_seeds
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

-- 3. home_seed_suggestions - Pending suggestions awaiting approval
CREATE TABLE public.home_seed_suggestions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  section_key text NOT NULL REFERENCES public.home_sections(key) ON DELETE CASCADE,
  query text NOT NULL,
  source text NOT NULL DEFAULT 'template',
  score integer DEFAULT 0,
  approved boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

-- Indexes
CREATE INDEX idx_home_seed_suggestions_section_approved ON public.home_seed_suggestions(section_key, approved);
CREATE INDEX idx_home_seed_suggestions_section_created ON public.home_seed_suggestions(section_key, created_at DESC);

-- Enable RLS
ALTER TABLE public.home_seed_suggestions ENABLE ROW LEVEL SECURITY;

-- RLS policies (admin only)
CREATE POLICY "Admins can view home_seed_suggestions"
ON public.home_seed_suggestions FOR SELECT
TO authenticated
USING (public.is_admin_role());

CREATE POLICY "Admins can manage home_seed_suggestions"
ON public.home_seed_suggestions FOR ALL
TO authenticated
USING (public.is_admin_role())
WITH CHECK (public.is_admin_role());

-- Service role bypass for edge functions
CREATE POLICY "Service role bypass home_seed_suggestions"
ON public.home_seed_suggestions FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- =====================================================================
-- Seed default sections matching current HOME_SECTIONS config
-- =====================================================================
INSERT INTO public.home_sections (key, title_en, title_fr, enabled, sort_order, default_category_key, ebay_category, is_vehicle, min_price, see_all_query) VALUES
  ('phones', 'Phones', 'Téléphones', true, 0, 'electronics_phones', '9355', false, 0, 'iphone'),
  ('vehicles', 'Vehicles', 'Véhicules', true, 1, 'vehicles_cars_trucks', '6001', true, 1500, 'cars'),
  ('gaming', 'Gaming', 'Gaming', true, 2, 'electronics_gaming', '1249', false, 0, 'ps5'),
  ('computers', 'Computers', 'Ordinateurs', true, 3, 'electronics_computers', '58058', false, 0, 'laptop'),
  ('clothing', 'Clothing & Shoes', 'Vêtements & Chaussures', true, 4, 'clothing_shoes_accessories', '63889', false, 0, 'shoes'),
  ('home_garden', 'Home & Garden', 'Maison & Jardin', true, 5, 'home_garden', '11700', false, 0, 'sofa'),
  ('refurbished', 'Refurbished', 'Reconditionné', true, 6, 'refurbished', '11800', false, 0, 'refurbished'),
  ('parts_accessories', 'Parts & Accessories', 'Pièces & Accessoires', true, 7, 'parts_accessories', '6028', false, 0, 'parts')
ON CONFLICT (key) DO NOTHING;

-- =====================================================================
-- Add admin_settings keys for home curation
-- =====================================================================
INSERT INTO public.admin_settings (key, value) VALUES
  ('home_seed_mode', 'manual'),
  ('home_seed_max_queries_per_section', '12'),
  ('home_generate_suggestion_count', '30')
ON CONFLICT (key) DO NOTHING;