
-- RPC for category counts used by admin-catalog-items summary
CREATE OR REPLACE FUNCTION public.admin_catalog_category_counts()
RETURNS TABLE(category_key text, active_count bigint, inactive_count bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT 
    COALESCE(ci.category_key, ci.unified_category, 'unknown') AS category_key,
    COUNT(*) FILTER (WHERE ci.is_active = true) AS active_count,
    COUNT(*) FILTER (WHERE ci.is_active = false) AS inactive_count
  FROM public.catalog_items ci
  GROUP BY COALESCE(ci.category_key, ci.unified_category, 'unknown')
  ORDER BY active_count DESC;
$$;

-- Revoke from anon/authenticated, only service_role can call
REVOKE EXECUTE ON FUNCTION public.admin_catalog_category_counts() FROM anon, authenticated;
