
-- Fix: Restrict admin_users SELECT to super_admins or admins with can_manage_users
DROP POLICY IF EXISTS "Only admins can view admin_users table" ON public.admin_users;

CREATE POLICY "Only authorized admins can view admin_users table"
ON public.admin_users
FOR SELECT
USING (
  auth.uid() IS NOT NULL
  AND public.is_admin_role()
  AND (
    public.is_super_admin_role()
    OR EXISTS (
      SELECT 1 FROM public.admin_user_permissions
      WHERE admin_user_permissions.user_id = auth.uid()
        AND admin_user_permissions.can_manage_users = true
    )
  )
);
