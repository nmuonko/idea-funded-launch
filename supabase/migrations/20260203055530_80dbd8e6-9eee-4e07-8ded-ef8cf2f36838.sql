-- Create feature_flags table for platform-specific feature gating
CREATE TABLE public.feature_flags (
  key text NOT NULL,
  platform text NOT NULL DEFAULT 'all',
  enabled boolean NOT NULL DEFAULT true,
  description text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (key, platform)
);

-- Index for fast lookups
CREATE INDEX idx_feature_flags_key ON public.feature_flags(key);

-- Seed initial flags
INSERT INTO public.feature_flags (key, platform, enabled, description) VALUES
  ('enable_amazon', 'all', true, 'Enable Amazon search globally'),
  ('enable_amazon', 'ios', false, 'Disable Amazon for iOS App Review'),
  ('enable_ebay', 'all', true, 'Enable eBay search globally');

-- RLS: Block all direct client access (service role only)
ALTER TABLE public.feature_flags ENABLE ROW LEVEL SECURITY;
CREATE POLICY "no_client_access" ON public.feature_flags
  FOR ALL USING (false) WITH CHECK (false);

-- Create search_proxy_cache table for per-source caching
CREATE TABLE public.search_proxy_cache (
  cache_key text PRIMARY KEY,
  source text NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);

-- Index for expiration cleanup
CREATE INDEX idx_search_proxy_cache_expires ON public.search_proxy_cache(expires_at);

-- RLS: Block all direct client access (service role only)
ALTER TABLE public.search_proxy_cache ENABLE ROW LEVEL SECURITY;
CREATE POLICY "no_client_access" ON public.search_proxy_cache
  FOR ALL USING (false) WITH CHECK (false);

-- Add updated_at trigger for feature_flags
CREATE OR REPLACE FUNCTION public.update_feature_flags_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_feature_flags_updated_at
  BEFORE UPDATE ON public.feature_flags
  FOR EACH ROW
  EXECUTE FUNCTION public.update_feature_flags_updated_at();