
DROP POLICY IF EXISTS "Admins read app secrets" ON public.app_secrets;
CREATE POLICY "Super admins read app secrets"
ON public.app_secrets FOR SELECT TO authenticated
USING (public.is_super_admin());

DROP POLICY IF EXISTS "Authenticated users can read catalog config" ON public.catalog_config;
DROP POLICY IF EXISTS "Authenticated users can read environments" ON public.environments;

REVOKE SELECT (client_secret, raw_request, raw_events) ON public.payments FROM authenticated;
REVOKE SELECT (client_secret, raw_request, raw_events) ON public.payments FROM anon;

DROP POLICY IF EXISTS "Authenticated users can read price cache" ON public.price_capture_cache;
CREATE POLICY "Admins can read price cache"
ON public.price_capture_cache FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "Authenticated users can read price history" ON public.price_history;
CREATE POLICY "Admins can read price history"
ON public.price_history FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'admin'::app_role));
