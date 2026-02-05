-- Add ebay_category_id column to catalog_sections for category filtering
ALTER TABLE catalog_sections 
ADD COLUMN IF NOT EXISTS ebay_category_id TEXT DEFAULT NULL;

-- Populate eBay category IDs for each section
UPDATE catalog_sections SET ebay_category_id = '9355' WHERE key = 'phones';
UPDATE catalog_sections SET ebay_category_id = '1249' WHERE key = 'video_games';
UPDATE catalog_sections SET ebay_category_id = '1249' WHERE key = 'gaming';
UPDATE catalog_sections SET ebay_category_id = '58058' WHERE key = 'computers';
UPDATE catalog_sections SET ebay_category_id = '6000' WHERE key = 'vehicles';
UPDATE catalog_sections SET ebay_category_id = '63889' WHERE key = 'fashion';
UPDATE catalog_sections SET ebay_category_id = '11450' WHERE key = 'clothing';
UPDATE catalog_sections SET ebay_category_id = '293' WHERE key = 'electronics';
UPDATE catalog_sections SET ebay_category_id = '220' WHERE key = 'toys';
UPDATE catalog_sections SET ebay_category_id = '11700' WHERE key = 'home_garden';

-- Add comment for documentation
COMMENT ON COLUMN catalog_sections.ebay_category_id IS 'eBay Browse API category_id for filtering search results';