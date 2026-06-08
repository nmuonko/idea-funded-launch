
-- Restrict SELECT on faq_kb to non-sensitive columns for authenticated users
REVOKE SELECT ON TABLE public.faq_kb FROM authenticated;
GRANT SELECT (id, question, answer, language, priority, is_active, created_at, updated_at) ON public.faq_kb TO authenticated;

-- Restrict SELECT on hot_products_showcase: hide price_usd, markup_usd, shipping_usd, created_by from public/authenticated
REVOKE SELECT ON TABLE public.hot_products_showcase FROM anon, authenticated;
GRANT SELECT (id, title, image_url, total_price_usd, product_url, provider, provider_product_id, sort_order, is_active, created_at, updated_at, link_source, description_fr, gallery_images) ON public.hot_products_showcase TO anon, authenticated;

-- Restrict SELECT on payments: hide client_secret, raw_request, raw_events from authenticated users (owners)
REVOKE SELECT ON TABLE public.payments FROM authenticated;
GRANT SELECT (id, order_id, provider_key, status, amount, currency, customer_phone, country, reference, provider_deposit_id, provider_transaction_id, created_at, updated_at, paid_at, kind) ON public.payments TO authenticated;

-- service_role retains full access (not affected by these REVOKEs on authenticated/anon)
