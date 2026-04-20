UPDATE public.hot_products_showcase
SET is_active = false
WHERE is_active = true
  AND COALESCE(total_price_usd, 0) > 200
  AND COALESCE(provider, '') NOT IN ('cargurus', 'carvana', 'ebay_motors');