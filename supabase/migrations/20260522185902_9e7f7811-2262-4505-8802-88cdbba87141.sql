DROP POLICY IF EXISTS "Service role full access on auto_seed_promotions" ON public.auto_seed_promotions;
CREATE POLICY "Service role full access on auto_seed_promotions" ON public.auto_seed_promotions FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service role write collection cache" ON public.catalog_collection_cache;
CREATE POLICY "Service role write collection cache" ON public.catalog_collection_cache FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow service role full access to filter profiles" ON public.catalog_filter_profiles;
CREATE POLICY "Allow service role full access to filter profiles" ON public.catalog_filter_profiles FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service role full access" ON public.catalog_item_media;
CREATE POLICY "Service role full access" ON public.catalog_item_media FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "System can manage category cache" ON public.ebay_category_cache;
CREATE POLICY "System can manage category cache" ON public.ebay_category_cache FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service role full access on home_seen_items" ON public.home_seen_items;
CREATE POLICY "Service role full access on home_seen_items" ON public.home_seen_items FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service role can manage prewarm jobs" ON public.prewarm_jobs;
CREATE POLICY "Service role can manage prewarm jobs" ON public.prewarm_jobs FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service role can manage scrape retry queue" ON public.scrape_retry_queue;
CREATE POLICY "Service role can manage scrape retry queue" ON public.scrape_retry_queue FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service role can insert topup logs" ON public.referral_topup_log;
CREATE POLICY "Service role can insert topup logs" ON public.referral_topup_log FOR INSERT TO service_role WITH CHECK (true);

DROP POLICY IF EXISTS "Users can insert their own payment attempts" ON public.payment_attempts;
CREATE POLICY "Users can insert their own payment attempts" ON public.payment_attempts FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Authorized users can view payments" ON public.payments;
CREATE POLICY "Authorized users can view payments" ON public.payments FOR SELECT TO authenticated USING (
  (EXISTS (SELECT 1 FROM orders WHERE orders.id = payments.order_id AND orders.user_id = auth.uid()))
  OR (has_role(auth.uid(), 'admin'::app_role) AND (
    (EXISTS (SELECT 1 FROM user_roles WHERE user_roles.user_id = auth.uid() AND user_roles.admin_role = 'super_admin'::text))
    OR (EXISTS (SELECT 1 FROM admin_user_permissions WHERE admin_user_permissions.user_id = auth.uid() AND admin_user_permissions.can_view_payments = true))
  ))
);

DROP POLICY IF EXISTS "Admins can manage bank transfer settings" ON public.bank_transfer_settings;
CREATE POLICY "Admins can manage bank transfer settings" ON public.bank_transfer_settings FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());