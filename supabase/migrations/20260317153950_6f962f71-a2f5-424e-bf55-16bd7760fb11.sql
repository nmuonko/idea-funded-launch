
CREATE TABLE public.hot_products_showcase (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text,
  image_url text,
  price_usd numeric DEFAULT 0,
  markup_usd numeric DEFAULT 0,
  shipping_usd numeric DEFAULT 0,
  total_price_usd numeric DEFAULT 0,
  product_url text,
  provider text,
  provider_product_id text,
  sort_order integer DEFAULT 0,
  is_active boolean DEFAULT true,
  created_by uuid,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.hot_products_showcase ENABLE ROW LEVEL SECURITY;

-- Public can view active showcase products
CREATE POLICY "Anyone can view active showcase products"
  ON public.hot_products_showcase FOR SELECT
  USING (is_active = true);

-- Admins can manage showcase products
CREATE POLICY "Admins can insert showcase products"
  ON public.hot_products_showcase FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin(auth.uid()));

CREATE POLICY "Admins can update showcase products"
  ON public.hot_products_showcase FOR UPDATE
  TO authenticated
  USING (public.is_admin(auth.uid()));

CREATE POLICY "Admins can delete showcase products"
  ON public.hot_products_showcase FOR DELETE
  TO authenticated
  USING (public.is_admin(auth.uid()));
