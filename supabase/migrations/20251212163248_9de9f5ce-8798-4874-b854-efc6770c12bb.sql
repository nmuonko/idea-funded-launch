-- Create product_hot_cache table for 5-15 minute TTL caching
CREATE TABLE IF NOT EXISTS public.product_hot_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  url TEXT UNIQUE NOT NULL,
  store TEXT NOT NULL DEFAULT 'generic',
  response_json JSONB NOT NULL,
  hit_count INTEGER DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);

-- Create indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_hot_cache_url ON public.product_hot_cache(url);
CREATE INDEX IF NOT EXISTS idx_hot_cache_expires ON public.product_hot_cache(expires_at);
CREATE INDEX IF NOT EXISTS idx_hot_cache_store ON public.product_hot_cache(store);

-- Enable RLS
ALTER TABLE public.product_hot_cache ENABLE ROW LEVEL SECURITY;

-- Service role can manage hot cache
CREATE POLICY "Service role can manage hot cache"
ON public.product_hot_cache
FOR ALL
USING (true);

-- Authenticated users can read hot cache
CREATE POLICY "Authenticated users can read hot cache"
ON public.product_hot_cache
FOR SELECT
USING (true);

-- Add store column to product_cache if missing
ALTER TABLE public.product_cache ADD COLUMN IF NOT EXISTS store TEXT DEFAULT 'generic';
CREATE INDEX IF NOT EXISTS idx_product_cache_store ON public.product_cache(store);
CREATE INDEX IF NOT EXISTS idx_product_cache_expires ON public.product_cache(expires_at);

-- Create cleanup function for hot cache
CREATE OR REPLACE FUNCTION public.clean_expired_hot_cache()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.product_hot_cache WHERE expires_at < now();
END;
$$;