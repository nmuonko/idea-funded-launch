-- =============================================
-- PART 1: Create price_history table
-- =============================================
CREATE TABLE public.price_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store text NOT NULL,
  product_key text NOT NULL,
  canonical_url text,
  title text,
  price_value numeric NOT NULL,
  currency text NOT NULL DEFAULT 'USD',
  source text NOT NULL CHECK (source IN ('tap', 'auto', 'manual')),
  confidence numeric NOT NULL DEFAULT 0,
  captured_at timestamptz NOT NULL DEFAULT now(),
  change_type text NOT NULL DEFAULT 'price_changed',
  prev_price_value numeric,
  prev_currency text
);

-- Indexes for efficient querying
CREATE INDEX idx_price_history_lookup ON public.price_history (store, product_key, captured_at DESC);
CREATE INDEX idx_price_history_recent ON public.price_history (captured_at DESC);

-- Enable RLS
ALTER TABLE public.price_history ENABLE ROW LEVEL SECURITY;

-- Public read access
CREATE POLICY "Public read price history"
  ON public.price_history FOR SELECT
  USING (true);

-- Insert only via service role (Edge Functions)
CREATE POLICY "Service role can insert history"
  ON public.price_history FOR INSERT
  WITH CHECK (true);

-- =============================================
-- PART 2: Update upsert_cached_price to track history
-- =============================================
CREATE OR REPLACE FUNCTION public.upsert_cached_price(
  store_input text,
  product_key_input text,
  canonical_url_input text,
  title_input text,
  price_value_input numeric,
  currency_input text,
  source_input text,
  confidence_input numeric,
  ttl_minutes integer
)
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

-- =============================================
-- PART 3: Instability detection RPC
-- =============================================
CREATE OR REPLACE FUNCTION public.get_price_instability(
  store_input text,
  product_key_input text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_changes_24h integer;
  v_changes_7d integer;
  v_is_unstable boolean;
  v_last_change timestamptz;
  v_price_range jsonb;
BEGIN
  -- Count changes in last 24 hours (excluding 'initial')
  SELECT COUNT(*) INTO v_changes_24h
  FROM price_history
  WHERE store = store_input 
    AND product_key = product_key_input
    AND change_type != 'initial'
    AND captured_at >= now() - interval '24 hours';
  
  -- Count changes in last 7 days (excluding 'initial')
  SELECT COUNT(*) INTO v_changes_7d
  FROM price_history
  WHERE store = store_input 
    AND product_key = product_key_input
    AND change_type != 'initial'
    AND captured_at >= now() - interval '7 days';
  
  -- Get last change timestamp
  SELECT MAX(captured_at) INTO v_last_change
  FROM price_history
  WHERE store = store_input 
    AND product_key = product_key_input
    AND change_type != 'initial';
  
  -- Get price range from history
  SELECT jsonb_build_object(
    'min_price', MIN(price_value),
    'max_price', MAX(price_value),
    'price_spread', MAX(price_value) - MIN(price_value)
  ) INTO v_price_range
  FROM price_history
  WHERE store = store_input 
    AND product_key = product_key_input
    AND captured_at >= now() - interval '7 days';
  
  -- Determine instability: >=2 changes in 24h OR >=3 changes in 7d
  v_is_unstable := (v_changes_24h >= 2) OR (v_changes_7d >= 3);
  
  RETURN jsonb_build_object(
    'store', store_input,
    'product_key', product_key_input,
    'is_unstable', v_is_unstable,
    'changes_24h', v_changes_24h,
    'changes_7d', v_changes_7d,
    'last_change_at', v_last_change,
    'price_range', COALESCE(v_price_range, '{}'::jsonb)
  );
END;
$$;

-- Add index on last_seen_at for price_capture_cache if not exists
CREATE INDEX IF NOT EXISTS idx_price_capture_cache_last_seen 
  ON public.price_capture_cache (last_seen_at DESC);