
CREATE OR REPLACE FUNCTION public.search_catalog_items_ranked(p_query text, p_min_price numeric DEFAULT 0, p_max_price numeric DEFAULT NULL::numeric, p_limit integer DEFAULT 100)
 RETURNS TABLE(id text, provider text, provider_product_id text, title text, brand text, price_usd numeric, image_url text, product_url text, relevance real)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH tokens AS (
    SELECT unnest(string_to_array(lower(trim(p_query)), ' ')) AS tok
  ),
  filtered_tokens AS (
    SELECT tok FROM tokens WHERE length(tok) >= 2
  ),
  token_count AS (
    SELECT count(*)::int AS cnt FROM filtered_tokens
  ),
  matched AS (
    SELECT
      ci.id,
      ci.provider,
      ci.provider_product_id,
      ci.title,
      ci.brand,
      ci.price_usd,
      ci.image_url,
      ci.product_url,
      similarity(lower(ci.title), lower(p_query)) AS relevance,
      (SELECT count(*) FROM filtered_tokens ft WHERE lower(ci.title) ILIKE '%' || ft.tok || '%')::int AS matched_tokens
    FROM public.catalog_items ci
    WHERE ci.provider IN ('amazon', 'ebay', 'cargurus', 'carvana', 'shein')
      AND ci.price_usd >= p_min_price
      AND ci.image_url IS NOT NULL
      AND ci.is_disallowed = false
      AND ci.is_active = true
      AND (p_max_price IS NULL OR ci.price_usd <= p_max_price)
      -- At least half the tokens must match (rounded up), or all if only 1-2 tokens
      AND (SELECT count(*) FROM filtered_tokens ft WHERE lower(ci.title) ILIKE '%' || ft.tok || '%')
          >= CASE WHEN (SELECT cnt FROM token_count) <= 2 THEN (SELECT cnt FROM token_count)
                  ELSE ((SELECT cnt FROM token_count) + 1) / 2
             END
  )
  SELECT
    m.id, m.provider, m.provider_product_id, m.title, m.brand,
    m.price_usd, m.image_url, m.product_url, m.relevance
  FROM matched m
  ORDER BY
    m.matched_tokens DESC,
    m.relevance DESC,
    m.id ASC
  LIMIT p_limit;
$function$;
