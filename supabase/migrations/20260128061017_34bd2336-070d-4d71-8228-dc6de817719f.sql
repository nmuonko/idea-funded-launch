-- Fix Price Cache RPC Functions: Add authentication checks
-- These functions use SECURITY DEFINER and need auth validation

-- Update get_cached_price to require authentication
CREATE OR REPLACE FUNCTION public.get_cached_price(store_input text, product_key_input text)
 RETURNS TABLE(id uuid, store text, product_key text, canonical_url text, title text, price_value numeric, currency text, source text, confidence numeric, captured_at timestamp with time zone, expires_at timestamp with time zone, capture_count integer, last_seen_at timestamp with time zone, is_expired boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $$
BEGIN
  -- Require authentication
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  RETURN QUERY
  SELECT 
    c.id,
    c.store,
    c.product_key,
    c.canonical_url,
    c.title,
    c.price_value,
    c.currency,
    c.source,
    c.confidence,
    c.captured_at,
    c.expires_at,
    c.capture_count,
    c.last_seen_at,
    (c.expires_at <= now()) AS is_expired
  FROM price_capture_cache c
  WHERE c.store = store_input
    AND c.product_key = product_key_input
  LIMIT 1;
END;
$$;

-- Update upsert_cached_price to require authentication
CREATE OR REPLACE FUNCTION public.upsert_cached_price(store_input text, product_key_input text, canonical_url_input text, title_input text, price_value_input numeric, currency_input text, source_input text, confidence_input numeric, ttl_minutes integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $$
DECLARE
  v_existing RECORD;
  v_result uuid;
  v_action text;
  v_price_changed boolean := false;
  v_currency_changed boolean := false;
  v_change_type text;
BEGIN
  -- Require authentication
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Authentication required'
    );
  END IF;

  -- Validate source
  IF source_input NOT IN ('tap', 'auto', 'manual') THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Invalid source. Must be tap, auto, or manual'
    );
  END IF;
  
  -- Block manual source by default
  IF source_input = 'manual' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Manual source is not allowed for cache writes'
    );
  END IF;
  
  -- Validate confidence for non-tap sources
  IF source_input = 'auto' AND confidence_input < 0.85 THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Auto source requires confidence >= 0.85'
    );
  END IF;
  
  -- Check existing entry
  SELECT * INTO v_existing
  FROM price_capture_cache
  WHERE store = store_input AND product_key = product_key_input
  FOR UPDATE;
  
  IF v_existing IS NULL THEN
    -- Insert new cache entry
    INSERT INTO price_capture_cache (
      store, product_key, canonical_url, title, price_value, currency,
      source, confidence, captured_at, expires_at, capture_count, last_seen_at
    ) VALUES (
      store_input, product_key_input, canonical_url_input, title_input,
      price_value_input, currency_input, source_input, confidence_input,
      now(), now() + (ttl_minutes || ' minutes')::interval, 1, now()
    )
    RETURNING id INTO v_result;
    
    -- Insert initial history entry
    INSERT INTO price_history (
      store, product_key, canonical_url, title, price_value, currency,
      source, confidence, captured_at, change_type, prev_price_value, prev_currency
    ) VALUES (
      store_input, product_key_input, canonical_url_input, title_input,
      price_value_input, currency_input, source_input, confidence_input,
      now(), 'initial', NULL, NULL
    );
    
    v_action := 'inserted';
  ELSE
    -- Check if price or currency changed
    v_price_changed := (price_value_input IS DISTINCT FROM v_existing.price_value);
    v_currency_changed := (currency_input IS DISTINCT FROM v_existing.currency);
    
    -- Determine if we should update
    IF source_input = 'tap' 
       OR v_existing.expires_at <= now() 
       OR confidence_input >= v_existing.confidence 
    THEN
      -- Record history ONLY if price or currency changed
      IF v_price_changed OR v_currency_changed THEN
        IF v_price_changed AND v_currency_changed THEN
          v_change_type := 'price_and_currency_changed';
        ELSIF v_price_changed THEN
          v_change_type := 'price_changed';
        ELSE
          v_change_type := 'currency_changed';
        END IF;
        
        INSERT INTO price_history (
          store, product_key, canonical_url, title, price_value, currency,
          source, confidence, captured_at, change_type, prev_price_value, prev_currency
        ) VALUES (
          store_input, product_key_input, 
          COALESCE(canonical_url_input, v_existing.canonical_url),
          COALESCE(title_input, v_existing.title),
          price_value_input, currency_input, source_input, confidence_input,
          now(), v_change_type, v_existing.price_value, v_existing.currency
        );
      END IF;
      
      -- Update cache
      UPDATE price_capture_cache SET
        canonical_url = COALESCE(canonical_url_input, canonical_url),
        title = COALESCE(title_input, title),
        price_value = price_value_input,
        currency = currency_input,
        source = source_input,
        confidence = confidence_input,
        captured_at = now(),
        expires_at = now() + (ttl_minutes || ' minutes')::interval,
        capture_count = capture_count + 1,
        last_seen_at = now()
      WHERE store = store_input AND product_key = product_key_input
      RETURNING id INTO v_result;
      
      v_action := 'updated';
    ELSE
      -- Skip update, existing is better - just bump last_seen
      UPDATE price_capture_cache SET
        last_seen_at = now()
      WHERE store = store_input AND product_key = product_key_input
      RETURNING id INTO v_result;
      
      v_action := 'skipped';
    END IF;
  END IF;
  
  RETURN jsonb_build_object(
    'success', true,
    'action', v_action,
    'id', v_result,
    'price_changed', v_price_changed,
    'currency_changed', v_currency_changed,
    'expires_at', (now() + (ttl_minutes || ' minutes')::interval)
  );
END;
$$;