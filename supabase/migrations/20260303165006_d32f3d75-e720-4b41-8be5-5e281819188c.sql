CREATE OR REPLACE FUNCTION public.get_active_providers()
RETURNS TABLE(provider text, item_count bigint)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT provider, COUNT(*) as item_count
  FROM catalog_items
  WHERE is_active = true AND is_disallowed = false AND price_usd > 0 AND provider IS NOT NULL
  GROUP BY provider
  ORDER BY item_count DESC;
$$;