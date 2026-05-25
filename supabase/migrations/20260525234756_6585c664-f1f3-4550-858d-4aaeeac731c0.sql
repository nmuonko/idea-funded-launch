
-- 1) payment_providers: split admin manage from super-admin SELECT
DROP POLICY IF EXISTS "Admins can manage payment providers" ON public.payment_providers;

CREATE POLICY "Super admins can view payment providers"
ON public.payment_providers
FOR SELECT
TO authenticated
USING (public.is_super_admin());

CREATE POLICY "Admins can insert payment providers"
ON public.payment_providers
FOR INSERT
TO authenticated
WITH CHECK (public.is_admin());

CREATE POLICY "Admins can update payment providers"
ON public.payment_providers
FOR UPDATE
TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

CREATE POLICY "Admins can delete payment providers"
ON public.payment_providers
FOR DELETE
TO authenticated
USING (public.is_admin());

-- 2) provider_budget: tighten to super_admin and rename
DROP POLICY IF EXISTS "Service role manages provider_budget" ON public.provider_budget;

CREATE POLICY "Super admins manage provider_budget"
ON public.provider_budget
FOR ALL
TO authenticated
USING (public.is_super_admin())
WITH CHECK (public.is_super_admin());

-- 3) referral_topup_log: restrict SELECT to super admins (PII: phone numbers)
DROP POLICY IF EXISTS "Admins can view topup logs" ON public.referral_topup_log;

CREATE POLICY "Super admins can view topup logs"
ON public.referral_topup_log
FOR SELECT
TO authenticated
USING (public.is_super_admin());

-- 4) Defense-in-depth RESTRICTIVE deny for non-admins
CREATE POLICY "Deny non-admin access to settings"
ON public.settings
AS RESTRICTIVE
FOR ALL
TO authenticated, anon
USING (public.is_admin())
WITH CHECK (public.is_admin());

CREATE POLICY "Deny non-admin access to bank_transfer_settings"
ON public.bank_transfer_settings
AS RESTRICTIVE
FOR ALL
TO authenticated, anon
USING (public.is_admin())
WITH CHECK (public.is_admin());
