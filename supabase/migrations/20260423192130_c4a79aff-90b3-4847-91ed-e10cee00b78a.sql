-- Unified pricing engine: title-aware category detection that matches the
-- all-inclusive TS engine used by cart, product detail, mobile, search, and
-- home edge functions. This guarantees the price shown on the homepage / search
-- via the RPC is byte-identical to the price shown on product detail and cart.

-- Helper: detect shipping category key from a product title
CREATE OR REPLACE FUNCTION public.detect_shipping_category_key(p_title text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public'
AS $$
DECLARE
  t text := lower(COALESCE(p_title, ''));
BEGIN
  IF t = '' THEN RETURN 'console_medium'; END IF;

  -- phone / camera
  IF t ~ '\m(iphone|samsung galaxy s|pixel [0-9]|motorola|oneplus|gopro|dslr|mirrorless camera)\M'
     OR t ~ '\m(phone|camera)\M' THEN
    RETURN 'phone_camera';
  END IF;

  -- small accessories
  IF t ~ '\m(earbuds|airpods|earbud|smartwatch|apple watch|charger|cable|adapter|power bank|memory card|usb|dongle|stylus|airtag)\M' THEN
    RETURN 'small_accessories';
  END IF;

  -- laptop
  IF t ~ '\m(laptop|macbook|chromebook|notebook|thinkpad|surface laptop|surface pro|surface book)\M' THEN
    RETURN 'laptop';
  END IF;

  -- tablet
  IF t ~ '\m(ipad|tablet|galaxy tab|fire hd|kindle)\M' THEN
    RETURN 'tablet';
  END IF;

  -- clothes / shoes
  IF t ~ '\m(shirt|dress|shoes|sneakers|jacket|pants|jeans|hoodie|sweater|clothing|apparel|boots|sandals|handbag|backpack)\M' THEN
    RETURN 'clothes_shoes';
  END IF;

  -- console / medium electronics
  IF t ~ '\m(playstation|xbox|nintendo|ps5|ps4|switch|printer|monitor|speaker|projector|router|steam deck)\M' THEN
    RETURN 'console_medium';
  END IF;

  -- TV / large appliance
  IF t ~ '\m(tv|television|refrigerator|washer|dryer|furniture|sofa|couch|dishwasher|oven|microwave)\M' THEN
    RETURN 'tv_large_appliance';
  END IF;

  RETURN 'console_medium';
END;
$$;

-- Replace existing single-price function: now title-aware and uses weight-based
-- shipping when a category exists, ceiled to whole-dollar (matches TS engine).
CREATE OR REPLACE FUNCTION public.compute_display_price(
  base_price_usd numeric,
  quantity integer DEFAULT 1
)
RETURNS numeric
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- No title → use default category (console_medium) for parity
  RETURN public.compute_display_price_titled(base_price_usd, NULL, quantity);
END;
$$;

-- New title-aware single-price function
CREATE OR REPLACE FUNCTION public.compute_display_price_titled(
  base_price_usd numeric,
  p_title text,
  quantity integer DEFAULT 1
)
RETURNS numeric
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_markup_percent numeric;
  v_shipping_rate_per_kg numeric;
  v_shipping_base_fee numeric;
  v_shipping_percent numeric;
  v_base_total numeric;
  v_markup numeric;
  v_shipping numeric;
  v_category_key text;
  v_est_weight_kg numeric;
  v_flat_shipping numeric;
  v_buffer_pct numeric;
  v_requires_quote boolean;
  v_category_found boolean := false;
BEGIN
  IF base_price_usd IS NULL OR base_price_usd <= 0 THEN
    RETURN base_price_usd;
  END IF;

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
  v_markup := v_base_total * (v_markup_percent / 100);

  v_category_key := public.detect_shipping_category_key(COALESCE(p_title, ''));

  SELECT
    sit.est_weight_kg, sit.flat_shipping_usd, sit.shipping_buffer_percent, sit.requires_manual_quote
  INTO v_est_weight_kg, v_flat_shipping, v_buffer_pct, v_requires_quote
  FROM shipping_item_types sit
  WHERE sit.key = v_category_key AND sit.active = true
  LIMIT 1;

  IF v_est_weight_kg IS NOT NULL THEN
    v_category_found := true;
  END IF;

  IF v_category_found THEN
    IF v_requires_quote THEN
      v_shipping := 0;
    ELSIF v_flat_shipping IS NOT NULL AND v_flat_shipping > 0 THEN
      v_shipping := v_flat_shipping * quantity * (1 + v_buffer_pct / 100);
    ELSE
      v_shipping := v_est_weight_kg * v_shipping_rate_per_kg * quantity * (1 + v_buffer_pct / 100);
    END IF;
  ELSE
    -- Legacy fallback (should rarely hit)
    IF v_shipping_percent > 1 THEN
      v_shipping_percent := v_shipping_percent / 100;
    END IF;
    v_shipping := v_shipping_base_fee + (v_base_total * v_shipping_percent);
  END IF;

  -- ceil to whole dollar — matches computeAllInclusivePrice() in TS engine
  RETURN CEIL(v_base_total + v_markup + v_shipping);
END;
$$;

-- Replace the batch function: now optionally accepts titles for category detection
CREATE OR REPLACE FUNCTION public.compute_display_prices(
  base_prices numeric[]
)
RETURNS numeric[]
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_result numeric[];
  v_price numeric;
BEGIN
  v_result := ARRAY[]::numeric[];
  FOREACH v_price IN ARRAY base_prices LOOP
    v_result := v_result || public.compute_display_price_titled(v_price, NULL, 1);
  END LOOP;
  RETURN v_result;
END;
$$;

-- Title-aware batch variant: callers passing titles get category-aware prices
CREATE OR REPLACE FUNCTION public.compute_display_prices_titled(
  base_prices numeric[],
  titles text[]
)
RETURNS numeric[]
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_result numeric[];
  v_price numeric;
  v_title text;
  v_idx integer := 1;
  v_len integer;
BEGIN
  v_len := COALESCE(array_length(base_prices, 1), 0);
  v_result := ARRAY[]::numeric[];

  WHILE v_idx <= v_len LOOP
    v_price := base_prices[v_idx];
    v_title := CASE WHEN titles IS NOT NULL AND v_idx <= COALESCE(array_length(titles, 1), 0)
                    THEN titles[v_idx]
                    ELSE NULL END;
    v_result := v_result || public.compute_display_price_titled(v_price, v_title, 1);
    v_idx := v_idx + 1;
  END LOOP;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.detect_shipping_category_key(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.compute_display_price_titled(numeric, text, integer) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.compute_display_prices_titled(numeric[], text[]) TO anon, authenticated;