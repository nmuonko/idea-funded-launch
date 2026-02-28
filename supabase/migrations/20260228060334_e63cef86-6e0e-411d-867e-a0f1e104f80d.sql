
CREATE OR REPLACE FUNCTION public.get_catalog_breakdown_stats()
RETURNS TABLE (
  provider text,
  provider_count bigint,
  unified_category text,
  category_count bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH by_provider AS (
    SELECT provider AS grp, COUNT(*) AS cnt
    FROM public.catalog_items
    WHERE is_active = true AND is_disallowed = false AND provider IS NOT NULL
    GROUP BY provider
  ),
  by_category AS (
    SELECT COALESCE(unified_category, 'uncategorized') AS grp, COUNT(*) AS cnt
    FROM public.catalog_items
    WHERE is_active = true AND is_disallowed = false
    GROUP BY unified_category
    ORDER BY cnt DESC
    LIMIT 8
  )
  SELECT
    p.grp AS provider,
    p.cnt AS provider_count,
    NULL::text AS unified_category,
    NULL::bigint AS category_count
  FROM by_provider p
  UNION ALL
  SELECT
    NULL::text AS provider,
    NULL::bigint AS provider_count,
    c.grp AS unified_category,
    c.cnt AS category_count
  FROM by_category c;
$$;
