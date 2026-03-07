-- 1. Deactivate SHEIN category pages (not real products)
UPDATE catalog_items 
SET is_active = false, status_reason = 'category_page_not_product'
WHERE provider = 'shein' 
  AND provider_product_id LIKE 'path_%';

-- 2. Deactivate items with the known SHEIN placeholder image
UPDATE catalog_items
SET is_active = false, status_reason = 'placeholder_image'
WHERE provider = 'shein'
  AND image_url LIKE '%1585556531965e5d98ef5a432eab61147c16af31c6%';

-- 3. Upgrade thumbnail URLs to full-size for remaining active SHEIN items
UPDATE catalog_items
SET image_url = REGEXP_REPLACE(image_url, '_thumbnail_\d+x\d+', '')
WHERE provider = 'shein'
  AND is_active = true
  AND image_url LIKE '%_thumbnail_%';

-- 4. Deactivate SHEIN items with /v4/p/ccc/ images (color swatches)
UPDATE catalog_items
SET is_active = false, status_reason = 'color_swatch_image'
WHERE provider = 'shein'
  AND is_active = true
  AND image_url LIKE '%/v4/p/ccc/%';