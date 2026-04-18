ALTER TABLE public.international_products
  ADD COLUMN IF NOT EXISTS available_sizes text[] NOT NULL DEFAULT '{}';