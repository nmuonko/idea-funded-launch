-- Create price_capture_cache table for WebView tap-to-pick captures
CREATE TABLE public.price_capture_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store text NOT NULL,
  product_key text NOT NULL,
  canonical_url text,
  title text,
  price_value numeric NOT NULL,
  currency text NOT NULL DEFAULT 'USD',
  source text NOT NULL CHECK (source IN ('tap', 'auto', 'manual')),
  confidence numeric NOT NULL DEFAULT 0 CHECK (confidence >= 0 AND confidence <= 1),
  captured_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  capture_count int NOT NULL DEFAULT 1,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  
  -- Ensure deduplication: 1 row per product_key per store
  CONSTRAINT unique_store_product UNIQUE (store, product_key)
);

-- Create indexes for performance
CREATE INDEX idx_price_capture_store_product ON public.price_capture_cache (store, product_key);
CREATE INDEX idx_price_capture_expires ON public.price_capture_cache (expires_at);
CREATE INDEX idx_price_capture_store ON public.price_capture_cache (store);

-- Enable RLS
ALTER TABLE public.price_capture_cache ENABLE ROW LEVEL SECURITY;

-- Public read access (cache is shared globally)
CREATE POLICY "Anyone can read price cache"
  ON public.price_capture_cache
  FOR SELECT
  USING (true);

-- Authenticated users can insert with high confidence
CREATE POLICY "Authenticated users can insert high-confidence prices"
  ON public.price_capture_cache
  FOR INSERT
  TO authenticated
  WITH CHECK (
    (source = 'tap') OR 
    (source = 'auto' AND confidence >= 0.85) OR
    (source = 'manual' AND confidence >= 0.95)
  );

-- Authenticated users can update with high confidence
CREATE POLICY "Authenticated users can update high-confidence prices"
  ON public.price_capture_cache
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (
    (source = 'tap') OR 
    (source = 'auto' AND confidence >= 0.85) OR
    (source = 'manual' AND confidence >= 0.95)
  );

-- RPC: Get cached price (only if not expired)
CREATE OR REPLACE FUNCTION public.get_cached_price(
  store_input text,
  product_key_input text
)
RETURNS TABLE (
  id uuid,
  store text,
  product_key text,
  canonical_url text,
  title text,
  price_value numeric,
  currency text,
  source text,
  confidence numeric,
  captured_at timestamptz,
  expires_at timestamptz,
  capture_count int,
  last_seen_at timestamptz,
  is_expired boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
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

-- RPC: Upsert cached price with TTL
CREATE OR REPLACE FUNCTION public.upsert_cached_price(
  store_input text,
  product_key_input text,
  canonical_url_input text,
  title_input text,
  price_value_input numeric,
  currency_input text,
  source_input text,
  confidence_input numeric,
  ttl_minutes int
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
BEGIN
  -- Validate source
  IF source_input NOT IN ('tap', 'auto', 'manual') THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Invalid source. Must be tap, auto, or manual'
    );
  END IF;
  
  -- Validate confidence for non-tap sources
  IF source_input = 'auto' AND confidence_input < 0.85 THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Auto source requires confidence >= 0.85'
    );
  END IF;
  
  IF source_input = 'manual' AND confidence_input < 0.95 THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Manual source requires confidence >= 0.95'
    );
  END IF;
  
  -- Check existing entry
  SELECT * INTO v_existing
  FROM price_capture_cache
  WHERE store = store_input AND product_key = product_key_input
  FOR UPDATE;
  
  IF v_existing IS NULL THEN
    -- Insert new entry
    INSERT INTO price_capture_cache (
      store, product_key, canonical_url, title, price_value, currency,
      source, confidence, captured_at, expires_at, capture_count, last_seen_at
    ) VALUES (
      store_input, product_key_input, canonical_url_input, title_input,
      price_value_input, currency_input, source_input, confidence_input,
      now(), now() + (ttl_minutes || ' minutes')::interval, 1, now()
    )
    RETURNING id INTO v_result;
    v_action := 'inserted';
  ELSE
    -- Update only if:
    -- 1. Incoming confidence >= existing confidence, OR
    -- 2. Existing is expired, OR
    -- 3. Incoming source is 'tap' (highest trust)
    IF source_input = 'tap' 
       OR v_existing.expires_at <= now() 
       OR confidence_input >= v_existing.confidence 
    THEN
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
      -- Skip update, existing is better
      v_result := v_existing.id;
      v_action := 'skipped';
    END IF;
  END IF;
  
  RETURN jsonb_build_object(
    'success', true,
    'action', v_action,
    'id', v_result,
    'expires_at', (now() + (ttl_minutes || ' minutes')::interval)
  );
END;
$$;

-- RPC: Get store-specific TTL in minutes
CREATE OR REPLACE FUNCTION public.get_store_cache_ttl(store_input text)
RETURNS int
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE lower(store_input)
    WHEN 'amazon' THEN 720        -- 12 hours
    WHEN 'ebay' THEN 1440         -- 24 hours
    WHEN 'shein' THEN 1440        -- 24 hours
    WHEN 'walmart' THEN 1440      -- 24 hours
    WHEN 'bestbuy' THEN 1440      -- 24 hours
    WHEN 'target' THEN 1440       -- 24 hours
    WHEN 'temu' THEN 720          -- 12 hours (prices change frequently)
    WHEN 'wayfair' THEN 1440      -- 24 hours
    WHEN 'tesla' THEN 2880        -- 48 hours
    WHEN 'tesla_used' THEN 2880   -- 48 hours
    WHEN 'carvana' THEN 2880      -- 48 hours
    WHEN 'cargurus' THEN 2880     -- 48 hours
    WHEN 'edmunds' THEN 2880      -- 48 hours
    ELSE 720                       -- Default: 12 hours
  END;
$$;

-- Cleanup function for expired cache entries
CREATE OR REPLACE FUNCTION public.clean_expired_capture_cache()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.price_capture_cache 
  WHERE expires_at < now() - interval '7 days';
END;
$$;