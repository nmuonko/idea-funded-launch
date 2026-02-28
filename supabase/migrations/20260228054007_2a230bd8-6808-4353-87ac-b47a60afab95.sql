
CREATE OR REPLACE FUNCTION public.get_catalog_price_stats()
RETURNS TABLE (
  total_value numeric,
  avg_price numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    COALESCE(SUM(price_usd), 0) AS total_value,
    COALESCE(AVG(price_usd), 0) AS avg_price
  FROM public.catalog_items
  WHERE is_active = true
    AND is_disallowed = false
    AND price_usd IS NOT NULL
    AND price_usd > 0;
$$;
