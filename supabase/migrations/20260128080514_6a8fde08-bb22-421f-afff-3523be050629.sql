-- Add category_key column if not exists (rename from category)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'catalog_items' AND column_name = 'category' AND table_schema = 'public') THEN
    ALTER TABLE public.catalog_items RENAME COLUMN category TO category_key;
  END IF;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- Ensure category_key column exists
ALTER TABLE public.catalog_items 
ADD COLUMN IF NOT EXISTS category_key text;

-- Create catalog_collection_cache table for caching collection queries
CREATE TABLE IF NOT EXISTS public.catalog_collection_cache (
  key text PRIMARY KEY,
  provider text NOT NULL,
  collection_key text NOT NULL,
  page integer NOT NULL DEFAULT 1,
  page_size integer NOT NULL DEFAULT 20,
  item_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  total integer NOT NULL DEFAULT 0,
  ttl_seconds integer NOT NULL DEFAULT 21600,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Create indexes for catalog_items
CREATE INDEX IF NOT EXISTS idx_catalog_items_provider_updated 
ON public.catalog_items (provider, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_catalog_items_category_key 
ON public.catalog_items (category_key);

-- GIN index for text search (if pg_trgm extension exists)
DO $$ BEGIN
  CREATE INDEX idx_catalog_items_title_trgm ON public.catalog_items USING gin(title gin_trgm_ops);
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- Create indexes for collection cache
CREATE INDEX IF NOT EXISTS idx_collection_cache_provider_key 
ON public.catalog_collection_cache (provider, collection_key);

-- Enable RLS on collection cache
ALTER TABLE public.catalog_collection_cache ENABLE ROW LEVEL SECURITY;

-- Public read policy for collection cache
DROP POLICY IF EXISTS "Public read collection cache" ON public.catalog_collection_cache;
CREATE POLICY "Public read collection cache" 
ON public.catalog_collection_cache 
FOR SELECT 
USING (true);

-- Service role write policy for collection cache
DROP POLICY IF EXISTS "Service role write collection cache" ON public.catalog_collection_cache;
CREATE POLICY "Service role write collection cache" 
ON public.catalog_collection_cache 
FOR ALL 
USING (true)
WITH CHECK (true);

-- Add updated_at trigger for collection cache
CREATE OR REPLACE FUNCTION public.update_collection_cache_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_collection_cache_updated_at ON public.catalog_collection_cache;
CREATE TRIGGER set_collection_cache_updated_at
  BEFORE UPDATE ON public.catalog_collection_cache
  FOR EACH ROW
  EXECUTE FUNCTION public.update_collection_cache_updated_at();