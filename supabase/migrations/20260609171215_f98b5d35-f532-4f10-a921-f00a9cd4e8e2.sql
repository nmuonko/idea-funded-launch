
-- Peer-median price guardrail: catches under-priced listings for ANY product
-- by comparing each row's price to other listings with the same normalized
-- title. Generalizes the static phone floors to the whole catalog.

CREATE OR REPLACE FUNCTION public.flag_price_outliers(p_min_peers int DEFAULT 3, p_ratio numeric DEFAULT 0.45)
RETURNS TABLE(flagged_count bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  n bigint;
BEGIN
  WITH norm AS (
    SELECT id, price_usd,
           lower(regexp_replace(coalesce(title,''), '\s+', ' ', 'g')) AS norm_title
    FROM public.catalog_items
    WHERE title IS NOT NULL
      AND price_usd IS NOT NULL
      AND price_usd > 0
      AND (is_active IS NULL OR is_active = true)
  ),
  peers AS (
    SELECT norm_title,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY price_usd) AS median_usd,
           count(*) AS peer_count
    FROM norm
    GROUP BY norm_title
    HAVING count(*) >= p_min_peers
  ),
  bad AS (
    SELECT n.id
    FROM norm n
    JOIN peers p ON p.norm_title = n.norm_title
    WHERE n.price_usd < (p.median_usd * p_ratio)
      AND p.median_usd >= 20
  ),
  upd AS (
    UPDATE public.catalog_items ci
    SET needs_price_review = true,
        price_check_status = 'flagged',
        price_check_error  = 'price_outlier_vs_peers'
    FROM bad
    WHERE ci.id = bad.id
      AND (ci.needs_price_review IS NULL OR ci.needs_price_review = false)
    RETURNING ci.id
  )
  SELECT count(*) INTO n FROM upd;

  RETURN QUERY SELECT n;
END;
$$;

REVOKE ALL ON FUNCTION public.flag_price_outliers(int, numeric) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.flag_price_outliers(int, numeric) TO service_role;

-- Run immediately to clean current catalog
SELECT public.flag_price_outliers(3, 0.45);

-- Schedule hourly so newly ingested outliers get caught quickly
DO $$
BEGIN
  PERFORM cron.unschedule('catalog_price_outlier_guard');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'catalog_price_outlier_guard',
  '7 * * * *',
  $$SELECT public.flag_price_outliers(3, 0.45);$$
);
