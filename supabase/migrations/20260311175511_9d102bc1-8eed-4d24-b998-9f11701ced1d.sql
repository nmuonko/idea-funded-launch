
-- Add provider_product_id column to order_items for storing ASIN/eBay item ID
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS provider_product_id text;

-- Add canonical_url column for storing a stable, verified product URL
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS canonical_url text;

-- Backfill: extract ASIN from existing Amazon order items
UPDATE public.order_items
SET provider_product_id = upper((regexp_match(product_url, '(?:/dp/|/gp/(?:product|aw/d)/)([A-Z0-9]{10})', 'i'))[1]),
    canonical_url = CASE 
      WHEN (regexp_match(product_url, '(?:/dp/|/gp/(?:product|aw/d)/)([A-Z0-9]{10})', 'i'))[1] IS NOT NULL
      THEN 'https://www.amazon.com/dp/' || upper((regexp_match(product_url, '(?:/dp/|/gp/(?:product|aw/d)/)([A-Z0-9]{10})', 'i'))[1])
      ELSE product_url
    END
WHERE store = 'AMAZON' AND provider_product_id IS NULL;

-- Backfill: extract eBay item ID from existing eBay order items
UPDATE public.order_items
SET provider_product_id = (regexp_match(product_url, '/itm/(\d+)', 'i'))[1],
    canonical_url = product_url
WHERE store = 'EBAY' AND provider_product_id IS NULL AND product_url LIKE '%/itm/%';

-- For other stores, set canonical_url = product_url where missing
UPDATE public.order_items
SET canonical_url = product_url
WHERE canonical_url IS NULL;

-- Create index on provider_product_id for fast lookups
CREATE INDEX IF NOT EXISTS idx_order_items_provider_product_id ON public.order_items(provider_product_id) WHERE provider_product_id IS NOT NULL;
