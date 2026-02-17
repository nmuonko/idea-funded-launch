
-- Drop overly permissive policies
DROP POLICY IF EXISTS "Admin full access to referrers" ON public.referrers;
DROP POLICY IF EXISTS "Admin full access to payout_rules" ON public.referral_payout_rules;
DROP POLICY IF EXISTS "Admin full access to payout_claims" ON public.referral_payout_claims;

-- Create proper admin-only policies
CREATE POLICY "Admins can manage referrers"
ON public.referrers FOR ALL
TO authenticated
USING (public.is_admin());

CREATE POLICY "Admins can manage payout rules"
ON public.referral_payout_rules FOR ALL
TO authenticated
USING (public.is_admin());

CREATE POLICY "Admins can manage payout claims"
ON public.referral_payout_claims FOR ALL
TO authenticated
USING (public.is_admin());

-- Allow service_role full access (for edge functions like create-referrer)
CREATE POLICY "Service role full access to referrers"
ON public.referrers FOR ALL
TO service_role
USING (true);

CREATE POLICY "Service role full access to payout rules"
ON public.referral_payout_rules FOR ALL
TO service_role
USING (true);

CREATE POLICY "Service role full access to payout claims"
ON public.referral_payout_claims FOR ALL
TO service_role
USING (true);
