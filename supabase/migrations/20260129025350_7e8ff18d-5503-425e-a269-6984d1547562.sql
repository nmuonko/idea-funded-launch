-- Create catalog_seed_queries table for DB-first seeded catalog
CREATE TABLE IF NOT EXISTS public.catalog_seed_queries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category text NOT NULL,
  provider text NOT NULL,
  seed_key text NOT NULL,
  query text,
  ebay_category_id text,
  filters jsonb DEFAULT '{}'::jsonb,
  enabled boolean DEFAULT true,
  ttl_minutes integer DEFAULT 360,
  last_refreshed_at timestamptz,
  item_count integer DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT catalog_seed_queries_provider_seed_key_key UNIQUE (provider, seed_key)
);

-- Enable RLS (admin-only via service role)
ALTER TABLE public.catalog_seed_queries ENABLE ROW LEVEL SECURITY;

-- Policy: Only service role can manage seeds
CREATE POLICY "Service role can manage catalog seeds" 
  ON public.catalog_seed_queries
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Add trigger to auto-update updated_at
CREATE OR REPLACE FUNCTION public.update_catalog_seed_queries_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER update_catalog_seed_queries_updated_at
  BEFORE UPDATE ON public.catalog_seed_queries
  FOR EACH ROW EXECUTE FUNCTION public.update_catalog_seed_queries_updated_at();

-- Ensure catalog_items has unique constraint on provider + provider_product_id
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'catalog_items_provider_product_unique'
  ) THEN
    ALTER TABLE public.catalog_items 
      ADD CONSTRAINT catalog_items_provider_product_unique 
      UNIQUE (provider, provider_product_id);
  END IF;
EXCEPTION
  WHEN duplicate_object THEN
    NULL; -- Constraint already exists
END $$;

-- Add buying_options column if not exists (for motors filtering)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'catalog_items' 
    AND column_name = 'buying_options'
  ) THEN
    ALTER TABLE public.catalog_items ADD COLUMN buying_options text[];
  END IF;
END $$;

-- Add metadata column for storing ebay category path etc
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'catalog_items' 
    AND column_name = 'metadata'
  ) THEN
    ALTER TABLE public.catalog_items ADD COLUMN metadata jsonb DEFAULT '{}'::jsonb;
  END IF;
END $$;

-- Index for category + provider queries
CREATE INDEX IF NOT EXISTS idx_catalog_items_provider_unified_category 
  ON public.catalog_items(provider, unified_category);

-- Index for price filtering (motors)
CREATE INDEX IF NOT EXISTS idx_catalog_items_price_usd 
  ON public.catalog_items(price_usd) WHERE price_usd IS NOT NULL;

-- Composite index for home/category queries  
CREATE INDEX IF NOT EXISTS idx_catalog_items_unified_category_updated 
  ON public.catalog_items(unified_category, updated_at DESC);

COMMENT ON TABLE public.catalog_seed_queries IS 'Seed queries for DB-first catalog population. Admin-managed via edge functions.';