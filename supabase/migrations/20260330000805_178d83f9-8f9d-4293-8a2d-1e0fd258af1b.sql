
UPDATE catalog_items 
SET images = '["https://m.media-amazon.com/images/I/71tdMPb7AHL._AC_SL1500_.jpg","https://m.media-amazon.com/images/I/41xG8Yh0rlL._SL1500_.jpg","https://m.media-amazon.com/images/I/41H7OUC9vdL._SL1500_.jpg","https://m.media-amazon.com/images/I/61qwjAUVWjL._AC_SL1500_.jpg","https://m.media-amazon.com/images/I/319GDx3qT-L.jpg","https://m.media-amazon.com/images/I/21paNxoQE7L.jpg"]'::jsonb,
    updated_at = now()
WHERE provider_product_id = 'B0FQHSS8HT' AND provider = 'amazon';

UPDATE catalog_items 
SET images = '["https://m.media-amazon.com/images/I/71V6d8CR4PL._AC_SL1500_.jpg","https://m.media-amazon.com/images/I/41UPkD0ruML._SL1500_.jpg","https://m.media-amazon.com/images/I/41msggSuaoL._SL1500_.jpg"]'::jsonb,
    updated_at = now()
WHERE provider_product_id = 'B0FGJJGTWX' AND provider = 'amazon';
