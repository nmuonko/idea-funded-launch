ALTER TABLE public.international_products REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.international_products;