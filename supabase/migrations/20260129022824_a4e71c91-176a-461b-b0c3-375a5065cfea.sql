-- Fix the generate_catalog_search_text trigger function to use correct column names
-- The function was referencing NEW.category which doesn't exist

CREATE OR REPLACE FUNCTION public.generate_catalog_search_text()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  NEW.search_text = lower(
    COALESCE(NEW.title, '') || ' ' ||
    COALESCE(array_to_string(NEW.tags, ' '), '') || ' ' ||
    COALESCE(NEW.category_key, '') || ' ' ||
    COALESCE(NEW.unified_category, '') || ' ' ||
    COALESCE(NEW.provider, '')
  );
  RETURN NEW;
END;
$function$;

-- Now add the unified_category column
ALTER TABLE public.catalog_items 
ADD COLUMN IF NOT EXISTS unified_category text;

-- Create index for unified_category queries
CREATE INDEX IF NOT EXISTS idx_catalog_items_unified_category 
ON public.catalog_items(unified_category);

-- Create composite index for provider + unified_category queries
CREATE INDEX IF NOT EXISTS idx_catalog_items_provider_unified_category 
ON public.catalog_items(provider, unified_category);

-- Update existing items to have a default unified_category based on their category_key
UPDATE public.catalog_items
SET unified_category = COALESCE(category_key, 'electronics')
WHERE unified_category IS NULL;