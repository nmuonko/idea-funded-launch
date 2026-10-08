
-- Italy FedEx weight-bracket shipping rates (EUR), editable by super admins
CREATE TABLE public.vip_shipping_brackets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  min_kg NUMERIC(6,2) NOT NULL,
  max_kg NUMERIC(6,2) NOT NULL,
  express_eur NUMERIC(10,2),
  standard_eur NUMERIC(10,2),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT vip_shipping_brackets_range_check CHECK (min_kg >= 0 AND max_kg > min_kg)
);

GRANT SELECT ON public.vip_shipping_brackets TO authenticated;
GRANT ALL ON public.vip_shipping_brackets TO service_role;

ALTER TABLE public.vip_shipping_brackets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can read shipping brackets"
  ON public.vip_shipping_brackets FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin'));

CREATE POLICY "Admins can insert shipping brackets"
  ON public.vip_shipping_brackets FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin'));

CREATE POLICY "Admins can update shipping brackets"
  ON public.vip_shipping_brackets FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin'));

CREATE POLICY "Admins can delete shipping brackets"
  ON public.vip_shipping_brackets FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin'));

-- Seed the Italy FedEx rate table
INSERT INTO public.vip_shipping_brackets (min_kg, max_kg, express_eur, standard_eur) VALUES
  (0.5, 1.5, 40, NULL),
  (1.5, 2.5, 50, NULL),
  (2.5, 3.5, 65, 55),
  (3.5, 4.5, 70, 65),
  (4.5, 5.5, 75, 70),
  (5.5, 6.5, 85, 75),
  (6.5, 7.5, 95, 85),
  (7.5, 8.5, 100, 90),
  (8.5, 9.5, 120, 110),
  (9.5, 14.5, 170, 150),
  (14.5, 19.5, 200, 175),
  (19.5, 24.5, 250, 230),
  (24.5, 29.5, 280, 250);

-- Exchange-rate setting on the VIP settings singleton
ALTER TABLE public.vip_settings ADD COLUMN eur_usd_rate NUMERIC(10,4);
COMMENT ON COLUMN public.vip_settings.eur_usd_rate IS 'Manual EUR->USD rate for Italy FedEx shipping. NULL = automatic rate at import time.';

-- Audit fields on products: which shipping model produced the price
ALTER TABLE public.vip_products ADD COLUMN shipping_model TEXT NOT NULL DEFAULT 'rate_per_kg';
ALTER TABLE public.vip_products ADD COLUMN carrier TEXT;
ALTER TABLE public.vip_products ADD COLUMN eur_usd_rate NUMERIC(10,4);
ALTER TABLE public.vip_products ADD COLUMN shipping_cost_eur NUMERIC(10,2);
COMMENT ON COLUMN public.vip_products.shipping_model IS 'rate_per_kg | italy_fedex — internal only, never shown to customers';
COMMENT ON COLUMN public.vip_products.carrier IS 'fedex_express | fedex_standard | other — internal only';
COMMENT ON COLUMN public.vip_products.eur_usd_rate IS 'EUR->USD rate used at pricing time (audit; never recalculated later)';
COMMENT ON COLUMN public.vip_products.shipping_cost_eur IS 'Allocated shipping in EUR before conversion (Italy FedEx only)';
