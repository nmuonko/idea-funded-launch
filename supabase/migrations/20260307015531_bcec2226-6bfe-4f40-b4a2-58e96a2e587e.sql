-- Deactivate SHEIN items with no image or color swatch images (images3_ccc pattern)
UPDATE catalog_items
SET is_active = false, status_reason = 'no_valid_image'
WHERE provider = 'shein'
  AND is_active = true
  AND (image_url IS NULL OR image_url = '' OR image_url LIKE '%images3_ccc%');