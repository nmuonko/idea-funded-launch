-- Create price_cache table for storing extracted prices with TTL
CREATE TABLE public.price_cache (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  url TEXT NOT NULL,
  store TEXT NOT NULL DEFAULT 'generic',
  base_price NUMERIC NOT NULL,
  currency TEXT DEFAULT 'USD',
  display_price TEXT,
  fetched_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT (now() + interval '12 hours')
);

-- Create unique index on normalized URL for fast lookups
CREATE UNIQUE INDEX idx_price_cache_url ON public.price_cache (url);

-- Create index on expires_at for efficient cache cleanup
CREATE INDEX idx_price_cache_expires_at ON public.price_cache (expires_at);

-- Enable RLS
ALTER TABLE public.price_cache ENABLE ROW LEVEL SECURITY;

-- Allow service role full access (for edge functions)
CREATE POLICY "Service role can manage price cache"
ON public.price_cache
FOR ALL
USING (true);

-- Allow authenticated users to read cache
CREATE POLICY "Authenticated users can read price cache"
ON public.price_cache
FOR SELECT
USING (true);

-- Create function to clean expired cache entries
CREATE OR REPLACE FUNCTION public.clean_expired_price_cache()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.price_cache WHERE expires_at < now();
END;
$$;