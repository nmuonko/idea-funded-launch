GRANT SELECT ON public.hot_products_showcase TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.hot_products_showcase TO authenticated;
GRANT ALL ON public.hot_products_showcase TO service_role;