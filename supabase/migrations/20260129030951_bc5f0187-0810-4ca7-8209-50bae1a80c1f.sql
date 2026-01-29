-- Add unified_subcategory column to catalog_items
ALTER TABLE public.catalog_items 
ADD COLUMN IF NOT EXISTS unified_subcategory text;

-- Add index for unified_category + updated_at ordering
CREATE INDEX IF NOT EXISTS idx_catalog_items_unified_category_updated 
ON public.catalog_items (unified_category, updated_at DESC);

-- Add index for unified_subcategory + updated_at ordering
CREATE INDEX IF NOT EXISTS idx_catalog_items_unified_subcategory_updated 
ON public.catalog_items (unified_subcategory, updated_at DESC);

-- Add unique constraint on provider + provider_product_id (if not exists)
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
EXCEPTION WHEN duplicate_object THEN
    -- Constraint already exists
    NULL;
END $$;

-- Add composite index for subcategory queries under electronics
CREATE INDEX IF NOT EXISTS idx_catalog_items_electronics_subcategory 
ON public.catalog_items (unified_category, unified_subcategory, updated_at DESC)
WHERE unified_category = 'electronics';

-- Update trigger to set updated_at
CREATE OR REPLACE FUNCTION public.update_catalog_items_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS catalog_items_updated_at ON public.catalog_items;
CREATE TRIGGER catalog_items_updated_at
    BEFORE UPDATE ON public.catalog_items
    FOR EACH ROW
    EXECUTE FUNCTION public.update_catalog_items_updated_at();