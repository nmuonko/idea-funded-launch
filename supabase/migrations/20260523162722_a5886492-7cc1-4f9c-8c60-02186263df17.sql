
-- 1) payment_providers: drop public SELECT, admins-only via existing ALL policy
DROP POLICY IF EXISTS "Authenticated users can view enabled providers" ON public.payment_providers;

-- 2) referrers: drop the broken self-read policy (id is not auth.uid())
DROP POLICY IF EXISTS "Users can read own referrer profile" ON public.referrers;

-- 3) payments: drop duplicate user SELECT policy (covered by "Authorized users can view payments")
DROP POLICY IF EXISTS "Users can view their own payments" ON public.payments;

-- Restrict sensitive raw columns at column-grant level so authenticated users
-- cannot read provider raw payloads even when the row is visible to them.
REVOKE SELECT (raw_request, raw_events) ON public.payments FROM authenticated;
REVOKE SELECT (raw_request, raw_events) ON public.payments FROM anon;

-- 4) catalog_home_cache: replace overly broad service-role policy with one
--    scoped to the service_role only.
DROP POLICY IF EXISTS "Service role can manage catalog_home_cache" ON public.catalog_home_cache;
DROP POLICY IF EXISTS "Service role only access" ON public.catalog_home_cache;

CREATE POLICY "Service role manages catalog_home_cache"
ON public.catalog_home_cache
AS PERMISSIVE
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- 5) Explicit service_role INSERT policies for transfer-proof tables
CREATE POLICY "Service role can insert bank transfer submissions"
ON public.bank_transfer_submissions
FOR INSERT
TO service_role
WITH CHECK (true);

CREATE POLICY "Service role can insert manual transfer proofs"
ON public.manual_transfer_proofs
FOR INSERT
TO service_role
WITH CHECK (true);

-- 6) SECURITY DEFINER lookup so the "retrieve referral link" feature
--    can still find an active referrer by email without exposing the
--    referrers table to authenticated/anon SELECT.
CREATE OR REPLACE FUNCTION public.get_referrer_ref_code_by_email(p_email text)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT ref_code
  FROM public.referrers
  WHERE lower(email) = lower(p_email)
    AND status = 'active'
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_referrer_ref_code_by_email(text) FROM public;
GRANT EXECUTE ON FUNCTION public.get_referrer_ref_code_by_email(text) TO anon, authenticated;
