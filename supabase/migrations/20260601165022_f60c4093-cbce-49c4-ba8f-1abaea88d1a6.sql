
CREATE OR REPLACE FUNCTION public.get_hot_product_view_counts()
RETURNS TABLE(provider text, provider_product_id text, views bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT provider, provider_product_id, COUNT(*)::bigint AS views
  FROM public.hot_product_clicks
  WHERE event_type = 'view'
    AND provider_product_id IS NOT NULL
    AND provider_product_id <> ''
  GROUP BY provider, provider_product_id
$$;

GRANT EXECUTE ON FUNCTION public.get_hot_product_view_counts() TO anon, authenticated, service_role;
