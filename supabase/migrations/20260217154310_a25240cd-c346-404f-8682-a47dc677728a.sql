
-- RPC: relevance-ranked catalog item search with stable tie-breaker
CREATE OR REPLACE FUNCTION public.search_catalog_items_ranked(
  p_query text,
  p_min_price numeric DEFAULT 0,
  p_max_price numeric DEFAULT NULL,
  p_limit integer DEFAULT 30
)
RETURNS TABLE (
  id text,
  provider text,
  provider_product_id text,
  title text,
  brand text,
  price_usd numeric,
  image_url text,
  product_url text,
  relevance real
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    ci.id,
    ci.provider,
    ci.provider_product_id,
    ci.title,
    ci.brand,
    ci.price_usd,
    ci.image_url,
    ci.product_url,
    similarity(lower(ci.title), lower(p_query)) AS relevance
  FROM public.catalog_items ci
  WHERE ci.provider IN ('amazon', 'ebay')
    AND ci.price_usd >= p_min_price
    AND ci.image_url IS NOT NULL
    AND ci.is_disallowed = false
    AND ci.title ILIKE '%' || p_query || '%'
    AND (p_max_price IS NULL OR ci.price_usd <= p_max_price)
  ORDER BY
    similarity(lower(ci.title), lower(p_query)) DESC,
    ci.id ASC
  LIMIT p_limit;
$$;
