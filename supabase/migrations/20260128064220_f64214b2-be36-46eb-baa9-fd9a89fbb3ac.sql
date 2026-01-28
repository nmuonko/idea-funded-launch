-- Add is_disallowed column to catalog_items for content blocking
-- This marks items that should never be shown (books, subscriptions, streaming, etc.)

ALTER TABLE public.catalog_items 
ADD COLUMN IF NOT EXISTS is_disallowed boolean DEFAULT false;

-- Add index for filtering
CREATE INDEX IF NOT EXISTS idx_catalog_items_is_disallowed 
ON public.catalog_items (is_disallowed) 
WHERE is_disallowed = false;

-- Cleanup: Mark and then DELETE existing disallowed items based on title patterns
-- This ensures the DB is clean from the start

-- First update to mark (for audit trail)
UPDATE public.catalog_items
SET is_disallowed = true
WHERE 
  -- Books & Reading
  title ILIKE '%kindle%'
  OR title ILIKE '%audible%'
  OR title ILIKE '%ebook%'
  OR title ILIKE '%e-book%'
  OR title ILIKE '% book %'
  OR title ILIKE '% book'
  OR title ILIKE 'book %'
  OR title ILIKE '%books%'
  OR title ILIKE '%paperback%'
  OR title ILIKE '%hardcover%'
  OR title ILIKE '%audiobook%'
  OR title ILIKE '%magazine%'
  OR title ILIKE '%journal%'
  OR title ILIKE '% novel%'
  OR title ILIKE '%novel %'
  OR title ILIKE '%comics%'
  OR title ILIKE '%manga%'
  OR title ILIKE '%textbook%'
  -- Streaming & Video
  OR title ILIKE '%prime video%'
  OR title ILIKE '%primevideo%'
  OR title ILIKE '%video subscription%'
  OR title ILIKE '%streaming%'
  -- Subscriptions
  OR title ILIKE '%subscription%'
  OR title ILIKE '%membership%'
  OR title ILIKE '%unlimited%'
  -- URL patterns check (if product_url contains book/kindle paths)
  OR product_url ILIKE '%/books%'
  OR product_url ILIKE '%/kindle%'
  OR product_url ILIKE '%/audible%'
  OR product_url ILIKE '%/gp/video%'
  OR product_url ILIKE '%/prime-video%';

-- Now delete all disallowed items to keep DB clean
DELETE FROM public.catalog_items WHERE is_disallowed = true;

-- Also clean from catalog_cache if it contains disallowed items in response JSON
-- (Skip this for now as it's complex JSON manipulation - the endpoints will filter)

-- Update catalog_collections to remove any disallowed item_ids
-- This is tricky with array manipulation, so we'll handle it in the edge functions

-- Add comment for documentation
COMMENT ON COLUMN public.catalog_items.is_disallowed IS 'True if item should never be shown (books, subscriptions, streaming, etc.)';

-- Create function to check disallowed on insert/update and prevent storage
CREATE OR REPLACE FUNCTION public.check_catalog_item_disallowed()
RETURNS TRIGGER AS $$
DECLARE
  title_lower text;
  url_lower text;
BEGIN
  title_lower := LOWER(COALESCE(NEW.title, ''));
  url_lower := LOWER(COALESCE(NEW.product_url, ''));
  
  -- Check for disallowed keywords in title
  IF title_lower LIKE '%kindle%'
     OR title_lower LIKE '%audible%'
     OR title_lower LIKE '%ebook%'
     OR title_lower LIKE '%e-book%'
     OR title_lower LIKE '% book %'
     OR title_lower LIKE '% book'
     OR title_lower LIKE 'book %'
     OR title_lower LIKE '%books%'
     OR title_lower LIKE '%paperback%'
     OR title_lower LIKE '%hardcover%'
     OR title_lower LIKE '%audiobook%'
     OR title_lower LIKE '%magazine%'
     OR title_lower LIKE '%journal%'
     OR title_lower LIKE '% novel%'
     OR title_lower LIKE '%novel %'
     OR title_lower LIKE '%comics%'
     OR title_lower LIKE '%manga%'
     OR title_lower LIKE '%textbook%'
     OR title_lower LIKE '%prime video%'
     OR title_lower LIKE '%subscription%'
     OR title_lower LIKE '%membership%'
     OR title_lower LIKE '%streaming%'
     OR title_lower LIKE '%unlimited%'
  THEN
    NEW.is_disallowed := true;
    -- Skip insert entirely by returning NULL
    RETURN NULL;
  END IF;
  
  -- Check URL patterns
  IF url_lower LIKE '%/books%'
     OR url_lower LIKE '%/kindle%'
     OR url_lower LIKE '%/audible%'
     OR url_lower LIKE '%/gp/video%'
     OR url_lower LIKE '%/prime-video%'
  THEN
    NEW.is_disallowed := true;
    RETURN NULL;
  END IF;
  
  NEW.is_disallowed := false;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Create trigger to auto-block disallowed items on insert/update
DROP TRIGGER IF EXISTS trg_check_catalog_item_disallowed ON public.catalog_items;
CREATE TRIGGER trg_check_catalog_item_disallowed
  BEFORE INSERT OR UPDATE ON public.catalog_items
  FOR EACH ROW
  EXECUTE FUNCTION public.check_catalog_item_disallowed();