-- Create catalog_search_cache table for fast search results
CREATE TABLE IF NOT EXISTS public.catalog_search_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL DEFAULT 'rainforest',
  query text NOT NULL,
  page integer NOT NULL DEFAULT 1,
  page_size integer NOT NULL DEFAULT 20,
  amazon_domain text NOT NULL DEFAULT 'amazon.com',
  response jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Create unique index for cache lookups
CREATE UNIQUE INDEX IF NOT EXISTS catalog_search_cache_lookup_idx 
ON public.catalog_search_cache (provider, query, page, page_size, amazon_domain);

-- Create index on updated_at for cleanup
CREATE INDEX IF NOT EXISTS catalog_search_cache_updated_at_idx 
ON public.catalog_search_cache (updated_at);

-- Enable RLS
ALTER TABLE public.catalog_search_cache ENABLE ROW LEVEL SECURITY;

-- Allow service role full access (edge functions)
CREATE POLICY "Service role can manage search cache"
ON public.catalog_search_cache
FOR ALL
USING (true)
WITH CHECK (true);

-- Allow authenticated users to read cache
CREATE POLICY "Authenticated users can read search cache"
ON public.catalog_search_cache
FOR SELECT
USING (true);

-- Add comment
COMMENT ON TABLE public.catalog_search_cache IS 'Cache for catalog search results to reduce API latency';