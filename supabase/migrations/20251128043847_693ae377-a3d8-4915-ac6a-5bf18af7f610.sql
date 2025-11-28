-- Create product cache table for 24-hour caching
CREATE TABLE IF NOT EXISTS public.product_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_url TEXT NOT NULL UNIQUE,
  title TEXT,
  image_url TEXT,
  price NUMERIC,
  currency TEXT DEFAULT 'USD',
  source TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  expires_at TIMESTAMP WITH TIME ZONE DEFAULT (now() + interval '24 hours')
);

-- Enable RLS
ALTER TABLE public.product_cache ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to read cache
CREATE POLICY "Authenticated users can read product cache"
ON public.product_cache
FOR SELECT
TO authenticated
USING (true);

-- Allow service role to insert/update cache
CREATE POLICY "Service role can manage product cache"
ON public.product_cache
FOR ALL
TO service_role
USING (true);

-- Index for faster lookups
CREATE INDEX idx_product_cache_url ON public.product_cache(product_url);
CREATE INDEX idx_product_cache_expires ON public.product_cache(expires_at);

-- Function to clean expired cache entries
CREATE OR REPLACE FUNCTION public.clean_expired_product_cache()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.product_cache WHERE expires_at < now();
END;
$$;