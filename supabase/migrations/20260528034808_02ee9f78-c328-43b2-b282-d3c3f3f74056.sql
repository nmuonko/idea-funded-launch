
-- 1) user_roles: prevent admin self-escalation. Only super admins may write.
DROP POLICY IF EXISTS "Only admins can insert roles" ON public.user_roles;
DROP POLICY IF EXISTS "Only admins can update roles" ON public.user_roles;
DROP POLICY IF EXISTS "Only admins can delete roles" ON public.user_roles;

CREATE POLICY "Only super admins can insert roles"
  ON public.user_roles
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_super_admin());

CREATE POLICY "Only super admins can update roles"
  ON public.user_roles
  FOR UPDATE
  TO authenticated
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

CREATE POLICY "Only super admins can delete roles"
  ON public.user_roles
  FOR DELETE
  TO authenticated
  USING (public.is_super_admin());

-- 2) faq_kb: hide internal routing fields from clients.
REVOKE SELECT (trigger_phrases, tags) ON public.faq_kb FROM PUBLIC;
REVOKE SELECT (trigger_phrases, tags) ON public.faq_kb FROM anon;
REVOKE SELECT (trigger_phrases, tags) ON public.faq_kb FROM authenticated;

-- 3) hot_products_showcase: hide margin / cost breakdown from the public web.
REVOKE SELECT (markup_usd, shipping_usd, price_usd) ON public.hot_products_showcase FROM PUBLIC;
REVOKE SELECT (markup_usd, shipping_usd, price_usd) ON public.hot_products_showcase FROM anon;
