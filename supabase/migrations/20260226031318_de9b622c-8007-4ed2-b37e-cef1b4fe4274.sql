
-- Phase 1: Drop dead indexes (0 scans) on catalog_items
DROP INDEX IF EXISTS idx_catalog_items_category_price;
DROP INDEX IF EXISTS idx_catalog_items_category;
DROP INDEX IF EXISTS idx_catalog_items_expires_active;
DROP INDEX IF EXISTS idx_catalog_items_in_stock;
DROP INDEX IF EXISTS idx_catalog_items_listing_type;
DROP INDEX IF EXISTS idx_catalog_items_fail_count;
DROP INDEX IF EXISTS idx_catalog_items_parts_subkey;
DROP INDEX IF EXISTS idx_catalog_items_brand;

-- Phase 2: Drop low-value/redundant indexes
DROP INDEX IF EXISTS idx_catalog_items_search_text_trgm;
DROP INDEX IF EXISTS idx_catalog_items_price;
DROP INDEX IF EXISTS idx_catalog_items_provider_updated;
DROP INDEX IF EXISTS idx_catalog_items_popularity_score_desc;
