-- Fix existing Amazon sspa/click URLs by converting to clean /dp/ASIN format
UPDATE catalog_items
SET product_url = 'https://www.amazon.com/dp/' || provider_product_id,
    updated_at = now()
WHERE provider IN ('rainforest', 'amazon')
  AND product_url LIKE '%/sspa/click%'
  AND provider_product_id IS NOT NULL
  AND provider_product_id != '';