-- Create catalog_home_cache table for cached homepage feeds
CREATE TABLE IF NOT EXISTS public.catalog_home_cache (
  id text PRIMARY KEY,
  env text NOT NULL,
  items jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  meta jsonb DEFAULT '{}'::jsonb
);

-- Index for fast lookups by env and expiration
CREATE INDEX IF NOT EXISTS idx_catalog_home_cache_env_expires 
  ON public.catalog_home_cache(env, expires_at);

-- Add home feed settings to admin_settings (upsert)
INSERT INTO public.admin_settings (key, value)
VALUES 
  ('home_feed_ttl_seconds', '172800'),
  ('home_feed_limit', '200'),
  ('home_feed_amazon_first_count', '100'),
  ('home_feed_deals_count', '100'),
  ('home_feed_enabled', 'true')
ON CONFLICT (key) DO NOTHING;

-- RLS policy - service role only for cache management
ALTER TABLE public.catalog_home_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role can manage catalog_home_cache"
  ON public.catalog_home_cache
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- Add comment for documentation
COMMENT ON TABLE public.catalog_home_cache IS 'Cached homepage product feeds with admin-controlled TTL';