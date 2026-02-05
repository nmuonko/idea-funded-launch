-- Create catalog_sections table for server-side category mapping
CREATE TABLE IF NOT EXISTS public.catalog_sections (
  key TEXT PRIMARY KEY,
  title_fr TEXT NOT NULL,
  title_en TEXT NOT NULL,
  seed_query TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('general', 'vehicle')),
  is_active BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.catalog_sections ENABLE ROW LEVEL SECURITY;

-- Allow public read access (catalog config is not sensitive)
CREATE POLICY "catalog_sections_public_read" ON public.catalog_sections
  FOR SELECT USING (true);

-- Only service role can modify
CREATE POLICY "catalog_sections_service_write" ON public.catalog_sections
  FOR ALL USING (auth.role() = 'service_role');

-- Seed the minimum required sections
INSERT INTO public.catalog_sections (key, title_fr, title_en, seed_query, mode, sort_order) VALUES
  ('phones', 'Téléphones', 'Phones', 'iphone samsung smartphone unlocked', 'general', 10),
  ('video_games', 'Jeux Vidéo', 'Video Games', 'ps5 xbox nintendo switch console', 'general', 20),
  ('computers', 'Ordinateurs', 'Computers', 'laptop macbook dell hp notebook', 'general', 30),
  ('vehicles', 'Véhicules', 'Vehicles', 'toyota honda rav4 camry car', 'vehicle', 40),
  ('fashion', 'Vêtements et Mode', 'Fashion', 'shoes sneakers nike adidas clothing', 'general', 50)
ON CONFLICT (key) DO UPDATE SET
  title_fr = EXCLUDED.title_fr,
  title_en = EXCLUDED.title_en,
  seed_query = EXCLUDED.seed_query,
  mode = EXCLUDED.mode,
  sort_order = EXCLUDED.sort_order,
  updated_at = now();

-- Create trigger for auto-updating updated_at
CREATE OR REPLACE FUNCTION public.update_catalog_sections_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS update_catalog_sections_updated_at ON public.catalog_sections;
CREATE TRIGGER update_catalog_sections_updated_at
  BEFORE UPDATE ON public.catalog_sections
  FOR EACH ROW
  EXECUTE FUNCTION public.update_catalog_sections_updated_at();

-- Add index for active sections ordered by sort_order
CREATE INDEX IF NOT EXISTS idx_catalog_sections_active_sort 
  ON public.catalog_sections (is_active, sort_order) 
  WHERE is_active = true;