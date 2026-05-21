
-- Rebuild Amazon source URLs from provider_product_id (ASIN)
UPDATE public.hot_products_showcase
SET product_url = 'https://www.amazon.com/dp/' || upper(
  CASE
    WHEN provider_product_id ILIKE 'amazon_%' THEN substring(provider_product_id from 8)
    WHEN provider_product_id ILIKE 'rainforest_%' THEN substring(provider_product_id from 12)
    ELSE provider_product_id
  END
)
WHERE lower(provider) = 'amazon'
  AND coalesce(provider_product_id, '') <> ''
  AND (product_url LIKE 'https://afrishop-usa.com/product/%'
       OR product_url LIKE 'https://afrishop-usa.com/paste-link%'
       OR product_url LIKE 'https://afrishop-usa.com/share/hp/%');

-- Rebuild eBay source URLs from provider_product_id
UPDATE public.hot_products_showcase
SET product_url = 'https://www.ebay.com/itm/' || (
  CASE
    WHEN provider_product_id LIKE 'v1|%' THEN split_part(provider_product_id, '|', 2)
    ELSE provider_product_id
  END
)
WHERE lower(provider) = 'ebay'
  AND coalesce(provider_product_id, '') <> ''
  AND (product_url LIKE 'https://afrishop-usa.com/product/%'
       OR product_url LIKE 'https://afrishop-usa.com/paste-link%'
       OR product_url LIKE 'https://afrishop-usa.com/share/hp/%');

-- Rebuild Walmart
UPDATE public.hot_products_showcase
SET product_url = 'https://www.walmart.com/ip/' || provider_product_id
WHERE lower(provider) = 'walmart'
  AND coalesce(provider_product_id, '') <> ''
  AND (product_url LIKE 'https://afrishop-usa.com/product/%'
       OR product_url LIKE 'https://afrishop-usa.com/paste-link%'
       OR product_url LIKE 'https://afrishop-usa.com/share/hp/%');
