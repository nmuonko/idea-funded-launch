UPDATE public.order_items
SET is_vehicle = false,
    vehicle_quote_applied = false,
    requires_manual_quote = false
WHERE is_vehicle = true
  AND store IS NOT NULL
  AND UPPER(store::text) IN ('AMAZON', 'EBAY', 'SHEIN', 'WALMART', 'ALIEXPRESS', 'SHOPIFY', 'OTHER');