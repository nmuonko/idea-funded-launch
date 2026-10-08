ALTER TABLE public.vip_products ADD COLUMN IF NOT EXISTS image_gallery jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.vip_products ADD COLUMN IF NOT EXISTS gallery_product_id uuid REFERENCES public.vip_products(id);
CREATE INDEX IF NOT EXISTS vip_products_gallery_product_idx ON public.vip_products(gallery_product_id);
COMMENT ON COLUMN public.vip_products.image_gallery IS 'Ordered photos of one garment; entries contain url and detected colors. Does not represent inventory quantity.';
COMMENT ON COLUMN public.vip_products.gallery_product_id IS 'Legacy photo-only listing alias pointing to its gallery product; retain for existing links and orders.';