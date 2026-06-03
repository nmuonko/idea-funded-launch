
-- 1) faq_kb: hide trigger_phrases & tags from authenticated
REVOKE SELECT ON public.faq_kb FROM authenticated;
REVOKE SELECT ON public.faq_kb FROM anon;
GRANT SELECT (id, question, answer, language, priority, is_active, created_at, updated_at)
  ON public.faq_kb TO authenticated;
GRANT SELECT (id, question, answer, language, priority, is_active, created_at, updated_at)
  ON public.faq_kb TO anon;

-- 2) hot_products_showcase: hide cost/margin columns from anon & authenticated
REVOKE SELECT ON public.hot_products_showcase FROM anon;
REVOKE SELECT ON public.hot_products_showcase FROM authenticated;
GRANT SELECT (id, title, image_url, total_price_usd, product_url, provider, provider_product_id, sort_order, is_active, created_at, link_source, gallery_images, description_fr)
  ON public.hot_products_showcase TO anon;
GRANT SELECT (id, title, image_url, total_price_usd, product_url, provider, provider_product_id, sort_order, is_active, created_at, link_source, gallery_images, description_fr)
  ON public.hot_products_showcase TO authenticated;

-- 3) payments: hide client_secret/raw_request/raw_events from end users
REVOKE SELECT ON public.payments FROM authenticated;
REVOKE SELECT ON public.payments FROM anon;
GRANT SELECT (id, order_id, reference, provider_key, status, amount, currency, customer_phone, country, created_at, updated_at, paid_at, provider_deposit_id, provider_transaction_id)
  ON public.payments TO authenticated;
