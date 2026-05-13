
CREATE OR REPLACE FUNCTION public.search_catalog_items_ranked(
  p_query text,
  p_min_price numeric DEFAULT 0,
  p_max_price numeric DEFAULT NULL::numeric,
  p_limit integer DEFAULT 500
)
RETURNS TABLE(
  id text, provider text, provider_product_id text, title text, brand text,
  price_usd numeric, image_url text, product_url text, relevance real
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_tokens text[];
  v_token_count int;
  v_min_match int;
  v_q text := lower(trim(coalesce(p_query, '')));
BEGIN
  -- Build token array (length >= 2)
  SELECT array_agg(t)
    INTO v_tokens
  FROM (
    SELECT DISTINCT t
    FROM unnest(string_to_array(v_q, ' ')) AS t
    WHERE length(t) >= 2
  ) s;

  v_tokens := COALESCE(v_tokens, ARRAY[]::text[]);
  v_token_count := array_length(v_tokens, 1);

  IF v_token_count IS NULL OR v_token_count = 0 THEN
    RETURN;
  END IF;

  v_min_match := CASE
    WHEN v_token_count <= 2 THEN v_token_count
    ELSE (v_token_count + 1) / 2
  END;

  RETURN QUERY
  WITH candidates AS (
    -- Single trigram-index-friendly predicate: title ILIKE ANY (tokens)
    -- (ILIKE is case-insensitive; GIN gin_trgm_ops on title accelerates this.)
    SELECT ci.id, ci.provider, ci.provider_product_id, ci.title, ci.brand,
           ci.price_usd, ci.image_url, ci.product_url
    FROM public.catalog_items ci
    WHERE ci.is_active = true
      AND ci.is_disallowed = false
      AND ci.image_url IS NOT NULL
      AND ci.provider IN ('amazon','ebay','cargurus','carvana','shein')
      AND ci.price_usd >= p_min_price
      AND (p_max_price IS NULL OR ci.price_usd <= p_max_price)
      AND ci.title ILIKE ANY (SELECT '%' || t || '%' FROM unnest(v_tokens) AS t)
    LIMIT 5000  -- safety cap before scoring
  ),
  scored AS (
    SELECT c.*,
      (
        SELECT count(*)::int
        FROM unnest(v_tokens) AS t
        WHERE c.title ILIKE '%' || t || '%'
      ) AS matched_tokens,
      similarity(lower(c.title), v_q) AS rel
    FROM candidates c
  )
  SELECT s.id, s.provider, s.provider_product_id, s.title, s.brand,
         s.price_usd, s.image_url, s.product_url, s.rel AS relevance
  FROM scored s
  WHERE s.matched_tokens >= v_min_match
  ORDER BY s.matched_tokens DESC, s.rel DESC, s.id ASC
  LIMIT p_limit;
END;
$function$;
