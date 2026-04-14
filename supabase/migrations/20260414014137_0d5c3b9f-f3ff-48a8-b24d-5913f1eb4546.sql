
ALTER TABLE public.hot_products_showcase
  ADD COLUMN IF NOT EXISTS description_fr TEXT,
  ADD COLUMN IF NOT EXISTS gallery_images TEXT[];
