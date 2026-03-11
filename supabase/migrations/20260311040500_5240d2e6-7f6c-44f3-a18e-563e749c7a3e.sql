-- Bulk upgrade eBay thumbnail images from s-l225 to s-l1600 for high-res display
UPDATE catalog_items 
SET image_url = regexp_replace(image_url, 's-l\d+', 's-l1600', 'gi'),
    updated_at = now()
WHERE image_url ~ 's-l(64|96|140|200|225|300|400|500)\b'
  AND is_active = true;