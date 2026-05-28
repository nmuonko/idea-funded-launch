
-- 1. app_secrets: tighten writes to super_admin
DROP POLICY IF EXISTS "Admins write app secrets" ON public.app_secrets;
DROP POLICY IF EXISTS "Admins update app secrets" ON public.app_secrets;
DROP POLICY IF EXISTS "Admins delete app secrets" ON public.app_secrets;

CREATE POLICY "Super admins write app secrets" ON public.app_secrets
  FOR INSERT TO authenticated WITH CHECK (is_super_admin());
CREATE POLICY "Super admins update app secrets" ON public.app_secrets
  FOR UPDATE TO authenticated USING (is_super_admin()) WITH CHECK (is_super_admin());
CREATE POLICY "Super admins delete app secrets" ON public.app_secrets
  FOR DELETE TO authenticated USING (is_super_admin());

-- 2. payment_providers: tighten writes to super_admin
DROP POLICY IF EXISTS "Admins can insert payment providers" ON public.payment_providers;
DROP POLICY IF EXISTS "Admins can update payment providers" ON public.payment_providers;
DROP POLICY IF EXISTS "Admins can delete payment providers" ON public.payment_providers;

CREATE POLICY "Super admins insert payment providers" ON public.payment_providers
  FOR INSERT TO authenticated WITH CHECK (is_super_admin());
CREATE POLICY "Super admins update payment providers" ON public.payment_providers
  FOR UPDATE TO authenticated USING (is_super_admin()) WITH CHECK (is_super_admin());
CREATE POLICY "Super admins delete payment providers" ON public.payment_providers
  FOR DELETE TO authenticated USING (is_super_admin());

-- 3. payments: revoke sensitive column SELECT from authenticated/anon
REVOKE SELECT (client_secret, raw_request, raw_events) ON public.payments FROM authenticated;
REVOKE SELECT (client_secret, raw_request, raw_events) ON public.payments FROM anon;
REVOKE SELECT (client_secret, raw_request, raw_events) ON public.payments FROM PUBLIC;

-- 4. environments: restrict to super_admin
DROP POLICY IF EXISTS "Admins can manage environments" ON public.environments;
CREATE POLICY "Super admins manage environments" ON public.environments
  FOR ALL TO authenticated USING (is_super_admin()) WITH CHECK (is_super_admin());

-- 5. checkout_funnel_log: remove anonymous insert
DROP POLICY IF EXISTS "checkout_funnel_log_anon_insert_null_user" ON public.checkout_funnel_log;

-- 6. faq_kb: hide internal routing fields from regular authenticated users
REVOKE SELECT (trigger_phrases, tags) ON public.faq_kb FROM authenticated;
REVOKE SELECT (trigger_phrases, tags) ON public.faq_kb FROM anon;
REVOKE SELECT (trigger_phrases, tags) ON public.faq_kb FROM PUBLIC;

-- 7. price_capture_cache: restrict SELECT to super_admin
DO $$
DECLARE p record;
BEGIN
  FOR p IN SELECT polname FROM pg_policy WHERE polrelid = 'public.price_capture_cache'::regclass AND polcmd IN ('r','*')
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.price_capture_cache', p.polname);
  END LOOP;
END $$;
CREATE POLICY "Super admins read price_capture_cache" ON public.price_capture_cache
  FOR SELECT TO authenticated USING (is_super_admin());
CREATE POLICY "Admins manage price_capture_cache" ON public.price_capture_cache
  FOR INSERT TO authenticated WITH CHECK (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Admins update price_capture_cache" ON public.price_capture_cache
  FOR UPDATE TO authenticated USING (has_role(auth.uid(), 'admin'::app_role)) WITH CHECK (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Admins delete price_capture_cache" ON public.price_capture_cache
  FOR DELETE TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));

-- 8. price_history: restrict SELECT to super_admin
DO $$
DECLARE p record;
BEGIN
  FOR p IN SELECT polname FROM pg_policy WHERE polrelid = 'public.price_history'::regclass AND polcmd IN ('r','*')
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.price_history', p.polname);
  END LOOP;
END $$;
CREATE POLICY "Super admins read price_history" ON public.price_history
  FOR SELECT TO authenticated USING (is_super_admin());
