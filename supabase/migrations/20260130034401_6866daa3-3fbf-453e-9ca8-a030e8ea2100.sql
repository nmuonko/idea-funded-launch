-- ============================================================================
-- Provider Mixing System: Admin Settings, Cache, and Budget Control
-- ============================================================================

-- 1. Create catalog_cache table for provider response caching
CREATE TABLE IF NOT EXISTS public.catalog_cache (
  cache_key TEXT PRIMARY KEY,
  cache_type TEXT NOT NULL CHECK (cache_type IN ('search', 'category', 'home', 'offers')),
  provider TEXT,
  query TEXT,
  category TEXT,
  page INTEGER,
  page_size INTEGER,
  amazon_domain TEXT,
  response JSONB NOT NULL DEFAULT '{}',
  stale_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Create indexes for cache cleanup and lookup
CREATE INDEX IF NOT EXISTS idx_catalog_cache_expires ON public.catalog_cache(expires_at);
CREATE INDEX IF NOT EXISTS idx_catalog_cache_stale ON public.catalog_cache(stale_at);
CREATE INDEX IF NOT EXISTS idx_catalog_cache_type_category ON public.catalog_cache(cache_type, category);

-- Enable RLS (admin only)
ALTER TABLE public.catalog_cache ENABLE ROW LEVEL SECURITY;

-- Admins can manage cache
CREATE POLICY "Admins can manage catalog_cache" ON public.catalog_cache
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- 2. Create provider_budget table for cost control
CREATE TABLE IF NOT EXISTS public.provider_budget (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider TEXT NOT NULL,
  window_type TEXT NOT NULL CHECK (window_type IN ('hour', 'day')),
  window_key TEXT NOT NULL UNIQUE, -- e.g., "amazon:hour:2026-01-30T10"
  window_start TIMESTAMPTZ NOT NULL,
  call_count INTEGER NOT NULL DEFAULT 0,
  limit_count INTEGER NOT NULL DEFAULT 100,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Create index for lookups
CREATE INDEX IF NOT EXISTS idx_provider_budget_window ON public.provider_budget(provider, window_key);

-- Enable RLS
ALTER TABLE public.provider_budget ENABLE ROW LEVEL SECURITY;

-- Allow service role full access (edge functions)
CREATE POLICY "Service role manages provider_budget" ON public.provider_budget
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- 3. Seed admin_settings with catalog provider configuration
-- (admin_settings table already exists, just insert/update keys)

-- Provider mode: mixed | ebay | amazon
INSERT INTO public.admin_settings (key, value) VALUES
  ('catalog_provider_mode', '"mixed"')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();

-- Individual provider toggles
INSERT INTO public.admin_settings (key, value) VALUES
  ('amazon_enabled', 'true'),
  ('ebay_enabled', 'true')
ON CONFLICT (key) DO NOTHING;

-- Amazon cost controls
INSERT INTO public.admin_settings (key, value) VALUES
  ('amazon_max_results_per_query', '200'),
  ('amazon_max_calls_per_hour', '100'),
  ('amazon_budget_window', '"hour"')
ON CONFLICT (key) DO NOTHING;

-- Mixed mode configuration
INSERT INTO public.admin_settings (key, value) VALUES
  ('mixed_amazon_first_count', '60'),
  ('mixed_blend_ratio', '{"amazon":1,"ebay":2}')
ON CONFLICT (key) DO NOTHING;

-- Cache TTLs (in seconds)
INSERT INTO public.admin_settings (key, value) VALUES
  ('search_cache_ttl_seconds', '172800'),
  ('home_cache_ttl_seconds', '86400'),
  ('offers_cache_ttl_seconds', '43200'),
  ('negative_cache_ttl_seconds', '120'),
  ('ebay_cache_ttl_seconds', '0')
ON CONFLICT (key) DO NOTHING;

-- Category rules (optional advanced feature)
INSERT INTO public.admin_settings (key, value) VALUES
  ('amazon_category_allowlist', '["electronics","electronics_phones","electronics_computers","electronics_gaming","electronics_cameras","electronics_audio"]'),
  ('enable_category_rules', 'false')
ON CONFLICT (key) DO NOTHING;

-- 4. Create function to increment provider budget atomically
CREATE OR REPLACE FUNCTION public.increment_provider_budget(
  p_provider TEXT,
  p_window_type TEXT,
  p_limit INTEGER DEFAULT 100
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_window_key TEXT;
  v_window_start TIMESTAMPTZ;
  v_current_count INTEGER;
  v_allowed BOOLEAN;
  v_remaining INTEGER;
BEGIN
  -- Calculate window key based on type
  IF p_window_type = 'hour' THEN
    v_window_start := date_trunc('hour', now());
    v_window_key := p_provider || ':hour:' || to_char(v_window_start, 'YYYY-MM-DD"T"HH24');
  ELSE
    v_window_start := date_trunc('day', now());
    v_window_key := p_provider || ':day:' || to_char(v_window_start, 'YYYY-MM-DD');
  END IF;

  -- Atomic upsert and increment
  INSERT INTO public.provider_budget (provider, window_type, window_key, window_start, call_count, limit_count)
  VALUES (p_provider, p_window_type, v_window_key, v_window_start, 1, p_limit)
  ON CONFLICT (window_key) DO UPDATE SET
    call_count = provider_budget.call_count + 1,
    updated_at = now()
  RETURNING call_count INTO v_current_count;

  v_allowed := v_current_count <= p_limit;
  v_remaining := GREATEST(0, p_limit - v_current_count);

  RETURN jsonb_build_object(
    'allowed', v_allowed,
    'count', v_current_count,
    'limit', p_limit,
    'remaining', v_remaining,
    'window_key', v_window_key,
    'window_start', v_window_start
  );
END;
$$;

-- 5. Create function to check budget without incrementing
CREATE OR REPLACE FUNCTION public.check_provider_budget(
  p_provider TEXT,
  p_window_type TEXT,
  p_limit INTEGER DEFAULT 100
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_window_key TEXT;
  v_window_start TIMESTAMPTZ;
  v_current_count INTEGER := 0;
  v_allowed BOOLEAN;
  v_remaining INTEGER;
BEGIN
  -- Calculate window key based on type
  IF p_window_type = 'hour' THEN
    v_window_start := date_trunc('hour', now());
    v_window_key := p_provider || ':hour:' || to_char(v_window_start, 'YYYY-MM-DD"T"HH24');
  ELSE
    v_window_start := date_trunc('day', now());
    v_window_key := p_provider || ':day:' || to_char(v_window_start, 'YYYY-MM-DD');
  END IF;

  -- Get current count
  SELECT call_count INTO v_current_count
  FROM public.provider_budget
  WHERE window_key = v_window_key;

  v_current_count := COALESCE(v_current_count, 0);
  v_allowed := v_current_count < p_limit;
  v_remaining := GREATEST(0, p_limit - v_current_count);

  RETURN jsonb_build_object(
    'allowed', v_allowed,
    'count', v_current_count,
    'limit', p_limit,
    'remaining', v_remaining,
    'window_key', v_window_key
  );
END;
$$;

-- 6. Create cleanup function for expired cache and old budget records
CREATE OR REPLACE FUNCTION public.cleanup_catalog_provider_data()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cache_deleted INTEGER;
  v_budget_deleted INTEGER;
BEGIN
  -- Delete expired cache entries (keep 1 hour buffer)
  DELETE FROM public.catalog_cache 
  WHERE expires_at < now() - interval '1 hour';
  GET DIAGNOSTICS v_cache_deleted = ROW_COUNT;
  
  -- Delete old budget records (older than 48 hours)
  DELETE FROM public.provider_budget 
  WHERE window_start < now() - interval '48 hours';
  GET DIAGNOSTICS v_budget_deleted = ROW_COUNT;
  
  RETURN jsonb_build_object(
    'success', true,
    'cache_deleted', v_cache_deleted,
    'budget_deleted', v_budget_deleted,
    'cleanup_at', now()
  );
END;
$$;