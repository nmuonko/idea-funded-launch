
-- 1. Country shipping rates table
CREATE TABLE public.country_shipping_rates (
  country TEXT PRIMARY KEY,
  label_en TEXT NOT NULL,
  label_fr TEXT NOT NULL,
  flag_emoji TEXT NOT NULL,
  rate_per_kg_usd NUMERIC(10,2) NOT NULL DEFAULT 20,
  enabled BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.country_shipping_rates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view country shipping rates"
  ON public.country_shipping_rates FOR SELECT
  USING (true);

CREATE POLICY "Admins can insert country shipping rates"
  ON public.country_shipping_rates FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin(auth.uid()));

CREATE POLICY "Admins can update country shipping rates"
  ON public.country_shipping_rates FOR UPDATE
  TO authenticated
  USING (public.is_admin(auth.uid()));

CREATE POLICY "Admins can delete country shipping rates"
  ON public.country_shipping_rates FOR DELETE
  TO authenticated
  USING (public.is_admin(auth.uid()));

-- Seed default rates
INSERT INTO public.country_shipping_rates (country, label_en, label_fr, flag_emoji, rate_per_kg_usd, sort_order) VALUES
  ('usa',    'USA',    'États-Unis', '🇺🇸', 20, 1),
  ('china',  'China',  'Chine',      '🇨🇳', 14, 2),
  ('dubai',  'Dubai',  'Dubaï',      '🇦🇪', 16, 3),
  ('turkey', 'Turkey', 'Turquie',    '🇹🇷', 18, 4);

-- 2. International products table (manually-added Dubai/China/Turkey items)
CREATE TABLE public.international_products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  country TEXT NOT NULL REFERENCES public.country_shipping_rates(country) ON UPDATE CASCADE,
  title TEXT NOT NULL,
  image_url TEXT NOT NULL,
  product_url TEXT NOT NULL,
  base_price_usd NUMERIC(12,2) NOT NULL CHECK (base_price_usd >= 0),
  est_weight_kg NUMERIC(10,3) NOT NULL DEFAULT 1 CHECK (est_weight_kg >= 0),
  description TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_international_products_country_active
  ON public.international_products(country, is_active, sort_order);

ALTER TABLE public.international_products ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view active international products"
  ON public.international_products FOR SELECT
  USING (is_active = true);

CREATE POLICY "Admins can view all international products"
  ON public.international_products FOR SELECT
  TO authenticated
  USING (public.is_admin(auth.uid()));

CREATE POLICY "Admins can insert international products"
  ON public.international_products FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin(auth.uid()));

CREATE POLICY "Admins can update international products"
  ON public.international_products FOR UPDATE
  TO authenticated
  USING (public.is_admin(auth.uid()));

CREATE POLICY "Admins can delete international products"
  ON public.international_products FOR DELETE
  TO authenticated
  USING (public.is_admin(auth.uid()));

-- updated_at triggers
CREATE TRIGGER trg_country_shipping_rates_updated_at
  BEFORE UPDATE ON public.country_shipping_rates
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER trg_international_products_updated_at
  BEFORE UPDATE ON public.international_products
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
