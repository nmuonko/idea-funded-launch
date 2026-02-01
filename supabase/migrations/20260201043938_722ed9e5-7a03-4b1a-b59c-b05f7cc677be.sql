-- Add images column to store full gallery
ALTER TABLE public.cars_listings_cache 
ADD COLUMN IF NOT EXISTS images jsonb DEFAULT '[]'::jsonb;

-- Add comment
COMMENT ON COLUMN public.cars_listings_cache.images IS 'Full gallery of image URLs for the car listing';