
-- 1. catalog_home_mobile_sections_cache: add explicit service_role bypass
DROP POLICY IF EXISTS "Service role full access" ON public.catalog_home_mobile_sections_cache;
CREATE POLICY "Service role full access"
ON public.catalog_home_mobile_sections_cache
FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 2. checkout_sessions: hide integrity_hash from clients
REVOKE SELECT (integrity_hash) ON public.checkout_sessions FROM anon, authenticated, PUBLIC;

-- 3. faq_kb: hide trigger_phrases and tags from authenticated/anon
REVOKE SELECT (trigger_phrases, tags) ON public.faq_kb FROM anon, authenticated, PUBLIC;

-- 4. hot_products_showcase: hide cost/margin columns
REVOKE SELECT (price_usd, markup_usd, shipping_usd) ON public.hot_products_showcase FROM anon, authenticated, PUBLIC;

-- 5. maisha_payments: hide raw payload columns
REVOKE SELECT (raw_request, raw_response, raw_query) ON public.maisha_payments FROM anon, authenticated, PUBLIC;

-- 6. payments: hide raw payload + client_secret columns
REVOKE SELECT (client_secret, raw_request, raw_events) ON public.payments FROM anon, authenticated, PUBLIC;

-- 7. marketer_thresholds: switch to has_role()
DROP POLICY IF EXISTS "Admin can read marketer_thresholds" ON public.marketer_thresholds;
DROP POLICY IF EXISTS "Admin can insert marketer_thresholds" ON public.marketer_thresholds;
DROP POLICY IF EXISTS "Admin can update marketer_thresholds" ON public.marketer_thresholds;
DROP POLICY IF EXISTS "Admin can delete marketer_thresholds" ON public.marketer_thresholds;

CREATE POLICY "Admins can read marketer_thresholds" ON public.marketer_thresholds
  FOR SELECT TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Admins can insert marketer_thresholds" ON public.marketer_thresholds
  FOR INSERT TO authenticated WITH CHECK (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Admins can update marketer_thresholds" ON public.marketer_thresholds
  FOR UPDATE TO authenticated USING (has_role(auth.uid(), 'admin'::app_role)) WITH CHECK (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Admins can delete marketer_thresholds" ON public.marketer_thresholds
  FOR DELETE TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));

-- 8. pricing_audit_log: switch to has_role()
DROP POLICY IF EXISTS "Admins can view pricing audit logs" ON public.pricing_audit_log;
CREATE POLICY "Admins can view pricing audit logs" ON public.pricing_audit_log
  FOR SELECT TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));

-- 9. product_bundles + product_bundle_items: switch to has_role()
DROP POLICY IF EXISTS "Admins can manage bundles" ON public.product_bundles;
CREATE POLICY "Admins can manage bundles" ON public.product_bundles
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "Admins can manage bundle items" ON public.product_bundle_items;
CREATE POLICY "Admins can manage bundle items" ON public.product_bundle_items
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- 10. referral_rewards: add admin SELECT policy
CREATE POLICY "Admins can view all referral rewards" ON public.referral_rewards
  FOR SELECT TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));

-- 11. referrers: require explicit can_view_customers permission
DROP POLICY IF EXISTS "Admins with customer permission can view referrers" ON public.referrers;
CREATE POLICY "Admins with customer permission can view referrers" ON public.referrers
  FOR SELECT TO authenticated
  USING (
    is_admin(auth.uid())
    AND admin_has_permission(auth.uid(), 'can_view_customers'::text)
  );

DROP POLICY IF EXISTS "Admins with manage permission can modify referrers" ON public.referrers;
CREATE POLICY "Admins with manage permission can modify referrers" ON public.referrers
  FOR ALL TO authenticated
  USING (
    is_admin(auth.uid())
    AND admin_has_permission(auth.uid(), 'can_view_customers'::text)
  )
  WITH CHECK (
    is_admin(auth.uid())
    AND admin_has_permission(auth.uid(), 'can_view_customers'::text)
  );
