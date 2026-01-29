-- Add unified_subcategory column to catalog_items if not exists
ALTER TABLE public.catalog_items 
ADD COLUMN IF NOT EXISTS unified_subcategory TEXT;

-- Create composite index for efficient category + subcategory queries
CREATE INDEX IF NOT EXISTS idx_catalog_items_category_subcategory 
ON public.catalog_items (unified_category, unified_subcategory, updated_at DESC)
WHERE is_disallowed = false OR is_disallowed IS NULL;

-- Create index for provider + product_id lookups (if not exists)
CREATE UNIQUE INDEX IF NOT EXISTS idx_catalog_items_provider_product 
ON public.catalog_items (provider, provider_product_id);

-- Create index for listing_type queries
CREATE INDEX IF NOT EXISTS idx_catalog_items_listing_type 
ON public.catalog_items (listing_type, unified_category)
WHERE is_disallowed = false OR is_disallowed IS NULL;