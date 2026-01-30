-- Create catalog_item_media table for caching exact image counts
CREATE TABLE public.catalog_item_media (
  provider text NOT NULL,
  provider_item_id text NOT NULL,
  image_urls jsonb NOT NULL DEFAULT '[]'::jsonb,
  image_count integer NOT NULL DEFAULT 0,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (provider, provider_item_id)
);

-- Add index for expiration cleanup
CREATE INDEX idx_catalog_item_media_expires_at ON public.catalog_item_media(expires_at);

-- Add RLS (service role only - edge functions access)
ALTER TABLE public.catalog_item_media ENABLE ROW LEVEL SECURITY;

-- No public access - only service role can read/write
CREATE POLICY "Service role full access" ON public.catalog_item_media
  FOR ALL USING (true) WITH CHECK (true);

-- Insert default media cache settings into admin_settings
INSERT INTO public.admin_settings (key, value) VALUES
  ('media_cache_ttl_days', '30'),
  ('media_prefetch_enabled', 'true'),
  ('media_prefetch_max_items_per_page', '20'),
  ('media_fetch_timeout_ms', '1200'),
  ('media_fetch_concurrency', '6')
ON CONFLICT (key) DO NOTHING;