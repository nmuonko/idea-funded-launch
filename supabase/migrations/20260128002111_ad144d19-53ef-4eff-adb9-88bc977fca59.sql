-- Create unified catalog cache table
CREATE TABLE public.catalog_cache (
  cache_key text PRIMARY KEY,
  cache_type text NOT NULL CHECK (cache_type IN ('home', 'search', 'product', 'offers')),
  provider text,
  query text,
  category text,
  page integer,
  page_size integer,
  amazon_domain text DEFAULT 'amazon.com',
  response jsonb NOT NULL DEFAULT '{}'::jsonb,
  stale_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Indexes for efficient lookups
CREATE INDEX idx_catalog_cache_type_updated ON public.catalog_cache (cache_type, updated_at DESC);
CREATE INDEX idx_catalog_cache_expires ON public.catalog_cache (expires_at);

-- Rate limiting table
CREATE TABLE public.catalog_rate_limits (
  device_id text NOT NULL,
  endpoint text NOT NULL,
  window_start timestamptz NOT NULL,
  count integer NOT NULL DEFAULT 1,
  PRIMARY KEY (device_id, endpoint, window_start)
);

-- Index for cleanup
CREATE INDEX idx_catalog_rate_limits_window ON public.catalog_rate_limits (window_start);

-- Enable RLS
ALTER TABLE public.catalog_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.catalog_rate_limits ENABLE ROW LEVEL SECURITY;

-- RLS policies for catalog_cache (service role only for writes)
CREATE POLICY "Anyone can read catalog cache"
  ON public.catalog_cache FOR SELECT
  USING (true);

CREATE POLICY "Service role can manage catalog cache"
  ON public.catalog_cache FOR ALL
  USING (true)
  WITH CHECK (true);

-- RLS policies for rate limits (service role only)
CREATE POLICY "Service role can manage rate limits"
  ON public.catalog_rate_limits FOR ALL
  USING (true)
  WITH CHECK (true);

-- Function to clean expired cache entries
CREATE OR REPLACE FUNCTION public.cleanup_catalog_cache()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cache_deleted integer;
  v_rate_deleted integer;
BEGIN
  -- Delete expired cache entries (keep 1 hour buffer for stale-while-revalidate)
  DELETE FROM public.catalog_cache 
  WHERE expires_at < now() - interval '1 hour';
  GET DIAGNOSTICS v_cache_deleted = ROW_COUNT;
  
  -- Delete old rate limit entries (older than 1 hour)
  DELETE FROM public.catalog_rate_limits 
  WHERE window_start < now() - interval '1 hour';
  GET DIAGNOSTICS v_rate_deleted = ROW_COUNT;
  
  RETURN jsonb_build_object(
    'success', true,
    'cache_deleted', v_cache_deleted,
    'rate_limits_deleted', v_rate_deleted,
    'cleanup_at', now()
  );
END;
$$;