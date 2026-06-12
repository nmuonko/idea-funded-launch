
-- catalog_providers: drop overlapping admin-ALL policies, restrict SELECT to super_admin
DROP POLICY IF EXISTS "Admins can manage all provider data" ON public.catalog_providers;
DROP POLICY IF EXISTS "Admins can manage providers" ON public.catalog_providers;

CREATE POLICY "Super admins can read catalog providers"
  ON public.catalog_providers
  FOR SELECT
  TO authenticated
  USING (public.is_super_admin());

CREATE POLICY "Admins can insert catalog providers"
  ON public.catalog_providers
  FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY "Admins can update catalog providers"
  ON public.catalog_providers
  FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY "Admins can delete catalog providers"
  ON public.catalog_providers
  FOR DELETE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));

-- manual_transfer_sessions: explicit service-role insert so server-side creation is documented
CREATE POLICY "Service role can insert manual transfer sessions"
  ON public.manual_transfer_sessions
  FOR INSERT
  TO service_role
  WITH CHECK (true);

CREATE POLICY "Service role can manage manual transfer sessions"
  ON public.manual_transfer_sessions
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- referral_payouts: explicit service-role full access for edge function payout processing
CREATE POLICY "Service role manages referral payouts"
  ON public.referral_payouts
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

COMMENT ON TABLE public.provider_tokens IS
  'OAuth provider tokens. Access restricted to service_role via edge functions only. RLS denies all anon/authenticated access. Do not create views joining this table to user-facing tables.';

COMMENT ON TABLE public.bank_transfer_settings IS
  'Admin-only source of truth for bank transfer config. End users receive user-facing bank details through admin_settings (key=bank_transfer_details).';
