
-- Restrict sensitive columns at the GRANT level (column-level privileges).
-- Pattern: REVOKE table SELECT then GRANT SELECT only on safe columns.
-- service_role keeps ALL privileges (bypasses RLS and is used by edge functions).

-- 1) faq_kb: hide trigger_phrases and tags from anon/authenticated.
REVOKE SELECT ON public.faq_kb FROM anon, authenticated;
GRANT SELECT (id, language, question, answer, is_active, priority, created_at, updated_at)
  ON public.faq_kb TO anon, authenticated;
GRANT ALL ON public.faq_kb TO service_role;

-- 2) hot_products_showcase: hide cost/margin (price_usd, markup_usd, shipping_usd) from anon.
--    Authenticated admins read cost columns from the admin panel, so keep authenticated SELECT.
REVOKE SELECT ON public.hot_products_showcase FROM anon;
GRANT SELECT (id, title, image_url, total_price_usd, product_url, provider,
              provider_product_id, sort_order, is_active, created_by,
              created_at, updated_at, link_source, description_fr, gallery_images)
  ON public.hot_products_showcase TO anon;
-- Also strip cost columns from authenticated to satisfy least-privilege; admin reads use a
-- security-definer RPC below.
REVOKE SELECT ON public.hot_products_showcase FROM authenticated;
GRANT SELECT (id, title, image_url, total_price_usd, product_url, provider,
              provider_product_id, sort_order, is_active, created_by,
              created_at, updated_at, link_source, description_fr, gallery_images)
  ON public.hot_products_showcase TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.hot_products_showcase TO authenticated;
GRANT ALL ON public.hot_products_showcase TO service_role;

-- Admin-only RPC to read full hot product rows (including cost columns).
CREATE OR REPLACE FUNCTION public.admin_list_hot_products()
RETURNS SETOF public.hot_products_showcase
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  RETURN QUERY SELECT * FROM public.hot_products_showcase ORDER BY sort_order ASC, created_at DESC;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_list_hot_products() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_list_hot_products() TO authenticated;

-- 3) payments: hide client_secret, raw_request, raw_events from authenticated customers.
REVOKE SELECT ON public.payments FROM anon, authenticated;
GRANT SELECT (id, order_id, provider_key, status, amount, currency,
              customer_phone, country, reference, provider_deposit_id,
              provider_transaction_id, created_at, updated_at, paid_at)
  ON public.payments TO authenticated;
-- anon needs the reference + order_id lookup for guest order tracking.
GRANT SELECT (order_id, reference) ON public.payments TO anon;
GRANT ALL ON public.payments TO service_role;
