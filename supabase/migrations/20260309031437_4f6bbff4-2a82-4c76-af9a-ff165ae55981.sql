
CREATE TABLE public.homepage_pinned_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_key TEXT NOT NULL,
  catalog_item_id TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'ebay',
  provider_product_id TEXT NOT NULL DEFAULT '',
  title TEXT,
  image_url TEXT,
  price_usd NUMERIC,
  sort_order INT NOT NULL DEFAULT 0,
  pinned_by UUID,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(category_key, catalog_item_id)
);

ALTER TABLE public.homepage_pinned_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins_manage_pins" ON public.homepage_pinned_items
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "anyone_can_read_pins" ON public.homepage_pinned_items
  FOR SELECT TO anon, authenticated
  USING (true);
