
-- 1) Revoke raw payload columns on maisha_payments from authenticated role
REVOKE SELECT (raw_request, raw_response, raw_query) ON public.maisha_payments FROM authenticated;
REVOKE SELECT (raw_request, raw_response, raw_query) ON public.maisha_payments FROM anon;

-- 2) Fix anon insert policy on checkout_funnel_log
DROP POLICY IF EXISTS "checkout_funnel_log_anon_insert" ON public.checkout_funnel_log;
DROP POLICY IF EXISTS "Anon can insert funnel log" ON public.checkout_funnel_log;
DROP POLICY IF EXISTS "anon_insert_checkout_funnel_log" ON public.checkout_funnel_log;

DO $$
DECLARE pol record;
BEGIN
  FOR pol IN
    SELECT policyname FROM pg_policies
    WHERE schemaname='public' AND tablename='checkout_funnel_log'
      AND cmd='INSERT' AND 'anon' = ANY(roles)
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.checkout_funnel_log', pol.policyname);
  END LOOP;
END $$;

CREATE POLICY "checkout_funnel_log_anon_insert_null_user"
ON public.checkout_funnel_log
FOR INSERT
TO anon
WITH CHECK (user_id IS NULL);

-- 3) Restrict price_validation_settings reads to authenticated users
DROP POLICY IF EXISTS "price_validation_settings_read" ON public.price_validation_settings;

CREATE POLICY "price_validation_settings_read"
ON public.price_validation_settings
FOR SELECT
TO authenticated
USING (true);
