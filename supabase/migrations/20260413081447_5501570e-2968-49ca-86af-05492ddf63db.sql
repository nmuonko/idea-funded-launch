-- Batch version: compute display prices for an array of base prices
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

  v_result := ARRAY[]::numeric[];
  FOREACH v_price IN ARRAY base_prices LOOP
    v_result := v_result || ROUND(
      v_price + 
      ROUND(v_price * (v_markup_percent / 100), 2) + 
      ROUND(v_shipping_base_fee + (v_price * (v_shipping_percent / 100)), 2),
      2
    );
  END LOOP;

  RETURN v_result;
END;
$$;