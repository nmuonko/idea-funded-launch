-- Drop the old incorrect functions
DROP FUNCTION IF EXISTS public.compute_display_price(numeric, integer);
DROP FUNCTION IF EXISTS public.compute_display_prices(numeric[]);
DROP FUNCTION IF EXISTS public.get_catalog_items_with_prices(text, integer, integer);

-- Recreate with correct weight-based shipping logic matching backend
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
  v_shipping_rate_per_kg numeric;
  v_base_total numeric;
  v_markup numeric;
  v_shipping numeric;
  v_default_weight_kg numeric := 6.0;
  v_default_buffer_pct numeric := 30.0;
BEGIN
  -- Read current settings
  SELECT 
    COALESCE((s.markup_percent)::numeric, 20),
    COALESCE((s.shipping_rate_per_kg)::numeric, 20)
  INTO v_markup_percent, v_shipping_rate_per_kg
  FROM settings s
  LIMIT 1;

  IF v_markup_percent IS NULL THEN
    v_markup_percent := 20;
    v_shipping_rate_per_kg := 20;
  END IF;

  v_base_total := base_price_usd * quantity;
  v_markup := ROUND(v_base_total * (v_markup_percent / 100), 2);
  
  -- Default shipping: use safe default category (console_medium: 6kg, 30% buffer)
  -- Without title context, we use the safe default
  v_shipping := ROUND(
    (v_default_weight_kg * v_shipping_rate_per_kg * quantity) * (1 + v_default_buffer_pct / 100), 
    2
  );

  RETURN ROUND(v_base_total + v_markup + v_shipping, 2);
END;
$$;

-- Category-aware version: takes a shipping category key for accurate calculation
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
  v_base_total numeric;
  v_markup numeric;
  v_shipping numeric;
  v_est_weight_kg numeric;
  v_flat_shipping numeric;
  v_buffer_pct numeric;
  v_requires_quote boolean;
BEGIN
  SELECT 
    COALESCE((s.markup_percent)::numeric, 20),
    COALESCE((s.shipping_rate_per_kg)::numeric, 20)
  INTO v_markup_percent, v_shipping_rate_per_kg
  FROM settings s
  LIMIT 1;

  IF v_markup_percent IS NULL THEN
    v_markup_percent := 20;
    v_shipping_rate_per_kg := 20;
  END IF;

  v_base_total := base_price_usd * quantity;
  v_markup := ROUND(v_base_total * (v_markup_percent / 100), 2);
  
  -- Look up shipping category
  IF p_category_key IS NOT NULL THEN
    SELECT 
      sit.est_weight_kg, sit.flat_shipping_usd, sit.shipping_buffer_percent, sit.requires_manual_quote
    INTO v_est_weight_kg, v_flat_shipping, v_buffer_pct, v_requires_quote
    FROM shipping_item_types sit
    WHERE sit.key = p_category_key AND sit.active = true
    LIMIT 1;
  END IF;

  -- Defaults if no category found
  IF v_est_weight_kg IS NULL THEN
    v_est_weight_kg := 6.0;
    v_flat_shipping := NULL;
    v_buffer_pct := 30.0;
    v_requires_quote := false;
  END IF;

  IF v_requires_quote THEN
    v_shipping := 0;
  ELSIF v_flat_shipping IS NOT NULL AND v_flat_shipping > 0 THEN
    v_shipping := ROUND(v_flat_shipping * quantity * (1 + v_buffer_pct / 100), 2);
  ELSE
    v_shipping := ROUND(v_est_weight_kg * v_shipping_rate_per_kg * quantity * (1 + v_buffer_pct / 100), 2);
  END IF;

  RETURN ROUND(v_base_total + v_markup + v_shipping, 2);
END;
$$;

-- Batch version using safe defaults (for catalog browsing without category context)
CREATE OR REPLACE FUNCTION public.compute_display_prices(base_prices numeric[])
RETURNS numeric[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_markup_percent numeric;
  v_shipping_rate_per_kg numeric;
  v_default_weight_kg numeric := 6.0;
  v_default_buffer_pct numeric := 30.0;
  v_result numeric[];
  v_price numeric;
  v_base numeric;
  v_markup numeric;
  v_shipping numeric;
BEGIN
  SELECT 
    COALESCE((s.markup_percent)::numeric, 20),
    COALESCE((s.shipping_rate_per_kg)::numeric, 20)
  INTO v_markup_percent, v_shipping_rate_per_kg
  FROM settings s
  LIMIT 1;

  IF v_markup_percent IS NULL THEN
    v_markup_percent := 20;
    v_shipping_rate_per_kg := 20;
  END IF;

  v_result := ARRAY[]::numeric[];
  FOREACH v_price IN ARRAY base_prices LOOP
    v_base := v_price;
    v_markup := ROUND(v_base * (v_markup_percent / 100), 2);
    v_shipping := ROUND(
      (v_default_weight_kg * v_shipping_rate_per_kg) * (1 + v_default_buffer_pct / 100), 
      2
    );
    v_result := v_result || ROUND(v_base + v_markup + v_shipping, 2);
  END LOOP;

  RETURN v_result;
END;
$$;

-- Catalog items query with server-computed prices
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
  v_shipping_rate_per_kg numeric;
  v_default_weight_kg numeric := 6.0;
  v_default_buffer_pct numeric := 30.0;
  v_default_shipping numeric;
BEGIN
  SELECT 
    COALESCE((s.markup_percent)::numeric, 20),
    COALESCE((s.shipping_rate_per_kg)::numeric, 20)
  INTO v_markup_percent, v_shipping_rate_per_kg
  FROM settings s
  LIMIT 1;

  IF v_markup_percent IS NULL THEN
    v_markup_percent := 20;
    v_shipping_rate_per_kg := 20;
  END IF;

  v_default_shipping := ROUND(
    (v_default_weight_kg * v_shipping_rate_per_kg) * (1 + v_default_buffer_pct / 100), 
    2
  );

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
      v_default_shipping,
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