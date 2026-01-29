-- Add brand column to catalog_items for diversity tracking
ALTER TABLE public.catalog_items 
ADD COLUMN IF NOT EXISTS brand text;

-- Create index for brand-based queries
CREATE INDEX IF NOT EXISTS idx_catalog_items_brand 
ON public.catalog_items (brand) 
WHERE brand IS NOT NULL;

-- Create composite index for category + brand queries
CREATE INDEX IF NOT EXISTS idx_catalog_items_category_brand 
ON public.catalog_items (unified_category, brand) 
WHERE unified_category IS NOT NULL;