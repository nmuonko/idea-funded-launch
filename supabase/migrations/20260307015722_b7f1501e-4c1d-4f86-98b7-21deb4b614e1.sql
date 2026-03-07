-- Invalidate stale home feed caches so they rebuild with clean SHEIN data
DELETE FROM home_cache_web_feed;
DELETE FROM catalog_home_cache;
DELETE FROM home_cache_mobile_sections;
DELETE FROM catalog_home_mobile_sections_cache;