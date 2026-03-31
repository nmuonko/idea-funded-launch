
-- Fix 1: checkout_handoff_tokens - drop the overly permissive public policy, replace with service_role + user-scoped
DROP POLICY IF EXISTS "Service role full access on checkout_handoff_tokens" ON public.checkout_handoff_tokens;

CREATE POLICY "Users can read own handoff tokens"
  ON public.checkout_handoff_tokens
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Fix 2: referral_commissions - fix SELECT policy to scope to referrer only
DROP POLICY IF EXISTS "Authenticated users can read own referral commissions" ON public.referral_commissions;

CREATE POLICY "Authenticated users can read own referral commissions"
  ON public.referral_commissions
  FOR SELECT
  TO authenticated
  USING (auth.uid() = referrer_id);

-- Fix 3: referrers - restrict SELECT to own row or admin
DROP POLICY IF EXISTS "Anyone can view referrers" ON public.referrers;
DROP POLICY IF EXISTS "Public can view referrers" ON public.referrers;
DROP POLICY IF EXISTS "Referrers are publicly readable" ON public.referrers;

CREATE POLICY "Users can read own referrer profile"
  ON public.referrers
  FOR SELECT
  TO authenticated
  USING (auth.uid() = id OR public.is_admin(auth.uid()));
