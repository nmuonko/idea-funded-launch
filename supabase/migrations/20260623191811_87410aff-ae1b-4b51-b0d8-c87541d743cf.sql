-- 1) payments_client_secret_exposed
CREATE TABLE IF NOT EXISTS public.payment_secrets (
  payment_id uuid PRIMARY KEY REFERENCES public.payments(id) ON DELETE CASCADE,
  client_secret text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

REVOKE ALL ON public.payment_secrets FROM PUBLIC;
REVOKE ALL ON public.payment_secrets FROM anon, authenticated;
GRANT ALL ON public.payment_secrets TO service_role;

ALTER TABLE public.payment_secrets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access to payment_secrets" ON public.payment_secrets;
CREATE POLICY "Service role full access to payment_secrets"
  ON public.payment_secrets
  AS PERMISSIVE FOR ALL TO service_role
  USING (true) WITH CHECK (true);

INSERT INTO public.payment_secrets (payment_id, client_secret, created_at)
SELECT id, client_secret, COALESCE(created_at, now())
FROM public.payments
WHERE client_secret IS NOT NULL
ON CONFLICT (payment_id) DO NOTHING;

ALTER TABLE public.payments DROP COLUMN IF EXISTS client_secret;


-- 2) referrers_table_pii_exposure
DROP POLICY IF EXISTS "Admins with customer permission can view referrers" ON public.referrers;
DROP POLICY IF EXISTS "Admins with manage permission can view referrers" ON public.referrers;

CREATE POLICY "Admins with manage permission can view referrers"
  ON public.referrers
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (
    is_admin(auth.uid())
    AND admin_has_permission(auth.uid(), 'can_manage_users'::text)
  );


-- 3) bank_transfer_settings_anon_restrictive_gap
REVOKE SELECT, INSERT, UPDATE, DELETE ON public.bank_transfer_settings FROM anon;

DROP POLICY IF EXISTS "Deny non-admin access to bank_transfer_settings" ON public.bank_transfer_settings;
CREATE POLICY "Deny non-admin access to bank_transfer_settings"
  ON public.bank_transfer_settings
  AS RESTRICTIVE FOR ALL TO authenticated, anon
  USING (auth.uid() IS NOT NULL AND is_admin())
  WITH CHECK (auth.uid() IS NOT NULL AND is_admin());


-- 4) dubai_uploads_public_storage_read
DROP POLICY IF EXISTS "Public read dubai uploads bucket" ON storage.objects;
CREATE POLICY "Public read approved dubai uploads"
  ON storage.objects
  AS PERMISSIVE FOR SELECT TO anon, authenticated
  USING (
    bucket_id = 'dubai-uploads'
    AND (storage.foldername(name))[1] = 'approved'
  );
