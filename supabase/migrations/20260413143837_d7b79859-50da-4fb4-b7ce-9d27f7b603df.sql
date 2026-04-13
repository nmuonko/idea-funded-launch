
-- Update compute_display_price to use legacy fallback
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
BEGIN
  SELECT 
    COALESCE((s.markup_percent)::numeric, 20),
    COALESCE((s.shipping_base_fee_usd)::numeric, 20),
    COALESCE((s.shipping_percent)::numeric, 10)
  INTO v_markup_percent, v_shipping_base_fee, v_shipping_percent
  FROM settings s
  LIMIT 1;

  IF v_markup_percent IS NULL THEN
    v_markup_percent := 20;
    v_shipping_base_fee := 20;
    v_shipping_percent := 10;
  END IF;

  v_base_total := base_price_usd * quantity;
  v_markup := ROUND(v_base_total * (v_markup_percent / 100), 2);
  
  -- Legacy fallback: flat base fee + percentage of base price
  IF v_shipping_percent > 1 THEN
    v_shipping_percent := v_shipping_percent / 100;
  END IF;
  v_shipping := ROUND(v_shipping_base_fee + (v_base_total * v_shipping_percent), 2);

  RETURN ROUND(v_base_total + v_markup + v_shipping, 2);
END;
$$;

-- Update compute_display_price_with_category: weight-based when category found, legacy fallback otherwise
CREATE OR REPLACE FUNCTION public.compute_display_price_with_category(
  base_price_usd numeric,
  p_category_key text DEFAULT NULL,
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
  v_shipping_rate_per_kg numeric;
  v_shipping_base_fee numeric;
  v_shipping_percent numeric;
  v_base_total numeric;
  v_markup numeric;
  v_shipping numeric;
  v_est_weight_kg numeric;
  v_flat_shipping numeric;
  v_buffer_pct numeric;
  v_requires_quote boolean;
  v_category_found boolean := false;
BEGIN
  SELECT 
    COALESCE((s.markup_percent)::numeric, 20),
    COALESCE((s.shipping_rate_per_kg)::numeric, 20),
    COALESCE((s.shipping_base_fee_usd)::numeric, 20),
    COALESCE((s.shipping_percent)::numeric, 10)
  INTO v_markup_percent, v_shipping_rate_per_kg, v_shipping_base_fee, v_shipping_percent
  FROM settings s
  LIMIT 1;

  IF v_markup_percent IS NULL THEN
    v_markup_percent := 20;
    v_shipping_rate_per_kg := 20;
    v_shipping_base_fee := 20;
    v_shipping_percent := 10;
  END IF;

  v_base_total := base_price_usd * quantity;
  v_markup := ROUND(v_base_total * (v_markup_percent / 100), 2);
  
  -- Try to look up shipping category
  IF p_category_key IS NOT NULL THEN
    SELECT 
      sit.est_weight_kg, sit.flat_shipping_usd, sit.shipping_buffer_percent, sit.requires_manual_quote
    INTO v_est_weight_kg, v_flat_shipping, v_buffer_pct, v_requires_quote
    FROM shipping_item_types sit
    WHERE sit.key = p_category_key AND sit.active = true
    LIMIT 1;

    IF v_est_weight_kg IS NOT NULL THEN
      v_category_found := true;
    END IF;
  END IF;

  IF v_category_found THEN
    -- Weight-based shipping with category data
    IF v_requires_quote THEN
      v_shipping := 0;
    ELSIF v_flat_shipping IS NOT NULL AND v_flat_shipping > 0 THEN
      v_shipping := ROUND(v_flat_shipping * quantity * (1 + v_buffer_pct / 100), 2);
    ELSE
      v_shipping := ROUND(v_est_weight_kg * v_shipping_rate_per_kg * quantity * (1 + v_buffer_pct / 100), 2);
    END IF;
  ELSE
    -- Legacy fallback: flat base fee + percentage
    IF v_shipping_percent > 1 THEN
      v_shipping_percent := v_shipping_percent / 100;
    END IF;
    v_shipping := ROUND(v_shipping_base_fee + (v_base_total * v_shipping_percent), 2);
  END IF;

  RETURN ROUND(v_base_total + v_markup + v_shipping, 2);
END;
$$;

-- Update batch version with legacy fallback
CREATE OR REPLACE FUNCTION public.compute_display_prices(base_prices numeric[])
RETURNS numeric[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_markup_percent numeric;
  v_shipping_base_fee numeric;
  v_shipping_percent numeric;
  v_result numeric[];
  v_price numeric;
  v_base numeric;
  v_markup numeric;
  v_shipping numeric;
BEGIN
  SELECT 
    COALESCE((s.markup_percent)::numeric, 20),
    COALESCE((s.shipping_base_fee_usd)::numeric, 20),
    COALESCE((s.shipping_percent)::numeric, 10)
  INTO v_markup_percent, v_shipping_base_fee, v_shipping_percent
  FROM settings s
  LIMIT 1;

  IF v_markup_percent IS NULL THEN
    v_markup_percent := 20;
    v_shipping_base_fee := 20;
    v_shipping_percent := 10;
  END IF;

  IF v_shipping_percent > 1 THEN
    v_shipping_percent := v_shipping_percent / 100;
  END IF;

  v_result := ARRAY[]::numeric[];
  FOREACH v_price IN ARRAY base_prices LOOP
    v_base := v_price;
    v_markup := ROUND(v_base * (v_markup_percent / 100), 2);
    v_shipping := ROUND(v_shipping_base_fee + (v_base * v_shipping_percent), 2);
    v_result := v_result || ROUND(v_base + v_markup + v_shipping, 2);
  END LOOP;

  RETURN v_result;
END;
$$;

-- Update catalog items query with legacy fallback shipping
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
    COALESCE((s.shipping_base_fee_usd)::numeric, 20),
    COALESCE((s.shipping_percent)::numeric, 10)
  INTO v_markup_percent, v_shipping_base_fee, v_shipping_percent
  FROM settings s
  LIMIT 1;

  IF v_markup_percent IS NULL THEN
    v_markup_percent := 20;
    v_shipping_base_fee := 20;
    v_shipping_percent := 10;
  END IF;

  IF v_shipping_percent > 1 THEN
    v_shipping_percent := v_shipping_percent / 100;
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
      ROUND(v_shipping_base_fee + (ci.price_usd * v_shipping_percent), 2),
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
