CREATE OR REPLACE FUNCTION public.compute_display_price(
  base_price_usd numeric,
  quantity integer DEFAULT 1
)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_markup_percent numeric;
  v_shipping_base_fee numeric;
  v_shipping_percent numeric;
  v_base_total numeric;
  v_markup numeric;
  v_shipping numeric;
  v_total numeric;
BEGIN
  SELECT 
    COALESCE((s.markup_percent)::numeric, 20),
    COALESCE((s.shipping_base_fee_usd)::numeric, 40),
    COALESCE((s.shipping_percent)::numeric, 10)
  INTO v_markup_percent, v_shipping_base_fee, v_shipping_percent
  FROM settings s
  LIMIT 1;

  IF v_markup_percent IS NULL THEN
    v_markup_percent := 20;
    v_shipping_base_fee := 40;
    v_shipping_percent := 10;
  END IF;

  v_base_total := base_price_usd * quantity;
  v_markup := ROUND(v_base_total * (v_markup_percent / 100), 2);
  v_shipping := ROUND(v_shipping_base_fee + (v_base_total * (v_shipping_percent / 100)), 2);
  v_total := ROUND(v_base_total + v_markup + v_shipping, 2);
  
  RETURN v_total;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_catalog_items_with_prices(
  p_category_key text DEFAULT NULL,
  p_limit integer DEFAULT 200,
  p_offset integer DEFAULT 0
)
RETURNS TABLE(
  id uuid,
  provider text,
  provider_product_id text,
  title text,
  image_url text,
  images jsonb,
  product_url text,
  price_usd numeric,
  display_price_usd numeric,
  rating numeric,
  in_stock boolean,
  category_key text,
  popularity_score numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_markup_percent numeric;
  v_shipping_base_fee numeric;
  v_shipping_percent numeric;
BEGIN
  SELECT 
    COALESCE((s.markup_percent)::numeric, 20),
    COALESCE((s.shipping_base_fee_usd)::numeric, 40),
    COALESCE((s.shipping_percent)::numeric, 10)
  INTO v_markup_percent, v_shipping_base_fee, v_shipping_percent
  FROM settings s
  LIMIT 1;

  IF v_markup_percent IS NULL THEN
    v_markup_percent := 20;
    v_shipping_base_fee := 40;
    v_shipping_percent := 10;
  END IF;

  RETURN QUERY
  SELECT 
    ci.id,
    ci.provider,
    ci.provider_product_id,
    ci.title,
    ci.image_url,
    ci.images::jsonb,
    ci.product_url,
    ci.price_usd,
    ROUND(
      ci.price_usd + 
      ROUND(ci.price_usd * (v_markup_percent / 100), 2) + 
      ROUND(v_shipping_base_fee + (ci.price_usd * (v_shipping_percent / 100)), 2),
      2
    ) AS display_price_usd,
    ci.rating,
    ci.in_stock,
    ci.category_key,
    ci.popularity_score
  FROM catalog_items ci
  WHERE ci.is_active = true
    AND ci.is_disallowed = false
    AND ci.price_usd > 0
    AND (p_category_key IS NULL OR ci.category_key = p_category_key)
  ORDER BY ci.popularity_score DESC NULLS LAST
  LIMIT p_limit
  OFFSET p_offset;
END;
$$;