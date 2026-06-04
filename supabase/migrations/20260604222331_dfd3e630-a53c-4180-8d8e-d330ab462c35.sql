REVOKE SELECT ON public.hot_product_campaigns FROM anon, authenticated;
GRANT SELECT (id, title, status, products, sent_at, created_at, updated_at) ON public.hot_product_campaigns TO anon, authenticated;
GRANT ALL ON public.hot_product_campaigns TO service_role;