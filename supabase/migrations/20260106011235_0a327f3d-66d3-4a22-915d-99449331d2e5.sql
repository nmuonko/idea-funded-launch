-- Fix the super admin RLS policy for admin_invitations to use the optimized function
DROP POLICY IF EXISTS "Super admins can view all invitations" ON public.admin_invitations;

CREATE POLICY "Super admins can view all invitations"
  ON public.admin_invitations
  FOR SELECT
  USING (is_super_admin());

-- Also simplify the "Admins can view invitations they sent" policy 
-- to ensure it works properly with auth.uid()
DROP POLICY IF EXISTS "Admins can view invitations they sent" ON public.admin_invitations;

CREATE POLICY "Admins can view invitations they sent"
  ON public.admin_invitations
  FOR SELECT
  USING (invited_by = auth.uid());