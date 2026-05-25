
-- 1. bank_transfer_settings: make admin-only SELECT explicit
DROP POLICY IF EXISTS "Admins can view bank transfer settings" ON public.bank_transfer_settings;
CREATE POLICY "Admins can view bank transfer settings"
  ON public.bank_transfer_settings
  FOR SELECT
  TO authenticated
  USING (public.is_admin());

-- 2. maisha_payments: remove fragile current_setting('role') checks (service_role bypasses RLS)
DROP POLICY IF EXISTS "Service role and admins can insert payments" ON public.maisha_payments;
DROP POLICY IF EXISTS "Service role and admins can update payments" ON public.maisha_payments;

CREATE POLICY "Admins can insert payments"
  ON public.maisha_payments
  FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY "Admins can update payments"
  ON public.maisha_payments
  FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

-- 3. payment_settings: restrict SELECT to admins (edge functions use service_role and bypass RLS)
DROP POLICY IF EXISTS "Authenticated users can read payment settings" ON public.payment_settings;
CREATE POLICY "Admins can read payment settings"
  ON public.payment_settings
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));

-- 4. price_capture_cache: remove authenticated write access; service_role still bypasses RLS for edge functions
DROP POLICY IF EXISTS "Authenticated users can insert high-confidence prices" ON public.price_capture_cache;
DROP POLICY IF EXISTS "Authenticated users can update high-confidence prices" ON public.price_capture_cache;

-- 5. provider_tokens: explicit deny-all + service_role intent (service_role bypasses RLS anyway)
-- Already has a 'false' policy; keep it but make intent explicit with a comment-style policy name
DROP POLICY IF EXISTS "Service role only for provider_tokens" ON public.provider_tokens;
CREATE POLICY "Deny all client access to provider_tokens"
  ON public.provider_tokens
  AS RESTRICTIVE
  FOR ALL
  TO authenticated, anon
  USING (false)
  WITH CHECK (false);

-- 6. Storage: restrict product-images upload/delete to admins only
DROP POLICY IF EXISTS "Authenticated users can upload product images" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can delete product images" ON storage.objects;

CREATE POLICY "Admins can upload product images"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'product-images' AND public.is_admin());

CREATE POLICY "Admins can update product images"
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (bucket_id = 'product-images' AND public.is_admin())
  WITH CHECK (bucket_id = 'product-images' AND public.is_admin());

CREATE POLICY "Admins can delete product images"
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (bucket_id = 'product-images' AND public.is_admin());
