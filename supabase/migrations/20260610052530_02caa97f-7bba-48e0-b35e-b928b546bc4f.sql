-- 1. Restrict admin_invitations SELECT to super admins only
DROP POLICY IF EXISTS "admins_can_view_all_invitations" ON public.admin_invitations;
CREATE POLICY "super_admins_can_view_all_invitations"
ON public.admin_invitations
FOR SELECT
TO authenticated
USING (is_super_admin());

-- 2. Revoke trigger_phrases and tags on faq_kb from authenticated users
REVOKE SELECT (trigger_phrases, tags) ON public.faq_kb FROM authenticated;
REVOKE SELECT (trigger_phrases, tags) ON public.faq_kb FROM anon;

-- 3. Revoke secret_key_name on catalog_providers from authenticated (admins use service-role in edge functions)
REVOKE SELECT (secret_key_name) ON public.catalog_providers FROM authenticated;
REVOKE SELECT (secret_key_name) ON public.catalog_providers FROM anon;

-- 4. Revoke secret_refs on payment_providers from authenticated (edge functions use service-role)
REVOKE SELECT (secret_refs) ON public.payment_providers FROM authenticated;
REVOKE SELECT (secret_refs) ON public.payment_providers FROM anon;