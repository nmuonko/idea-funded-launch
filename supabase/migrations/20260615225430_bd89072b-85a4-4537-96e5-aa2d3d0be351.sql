
REVOKE SELECT (secret_refs) ON public.payment_providers FROM anon;
REVOKE SELECT (secret_refs) ON public.payment_providers FROM authenticated;
REVOKE SELECT (secret_refs) ON public.payment_providers FROM PUBLIC;

GRANT SELECT (id, provider_key, display_name, is_enabled, is_default,
              supported_countries, supported_methods, priority,
              config_public, created_at, updated_at)
  ON public.payment_providers TO authenticated;

DROP POLICY IF EXISTS "Users can view their own checkout sessions" ON public.checkout_sessions;
CREATE POLICY "Users can view their own checkout sessions"
  ON public.checkout_sessions
  FOR SELECT
  TO authenticated
  USING (user_id IS NOT NULL AND auth.uid() = user_id);

DROP POLICY IF EXISTS "Authorized users can view checkout sessions" ON public.checkout_sessions;
CREATE POLICY "Authorized users can view checkout sessions"
  ON public.checkout_sessions
  FOR SELECT
  TO authenticated
  USING (
    (user_id IS NOT NULL AND auth.uid() = user_id)
    OR (
      has_role(auth.uid(), 'admin'::app_role)
      AND (
        EXISTS (
          SELECT 1 FROM user_roles
          WHERE user_roles.user_id = auth.uid()
            AND user_roles.admin_role = 'super_admin'
        )
        OR EXISTS (
          SELECT 1 FROM admin_user_permissions
          WHERE admin_user_permissions.user_id = auth.uid()
            AND admin_user_permissions.can_view_payments = true
        )
      )
    )
  );

DROP POLICY IF EXISTS "Admins insert dubai uploads" ON public.dubai_uploads;
CREATE POLICY "Admins insert dubai uploads"
  ON public.dubai_uploads
  FOR INSERT
  TO authenticated
  WITH CHECK (is_admin(auth.uid()));
