-- First, let's see what policies exist and recreate them properly

-- Drop existing policies on admin_invitations to start fresh
DROP POLICY IF EXISTS "Anyone can validate pending invitations by token" ON public.admin_invitations;
DROP POLICY IF EXISTS "Super admins can manage invitations" ON public.admin_invitations;
DROP POLICY IF EXISTS "Admins can view invitations" ON public.admin_invitations;
DROP POLICY IF EXISTS "Users can view their own invitation" ON public.admin_invitations;
DROP POLICY IF EXISTS "Sender can view their own invitations" ON public.admin_invitations;
DROP POLICY IF EXISTS "Super admins can view all invitations" ON public.admin_invitations;
DROP POLICY IF EXISTS "allow_anon_token_validation" ON public.admin_invitations;

-- Ensure RLS is enabled
ALTER TABLE public.admin_invitations ENABLE ROW LEVEL SECURITY;

-- Policy 1: Allow ANYONE (including anonymous) to SELECT pending invitations by token
-- This is needed for the accept-invite page to validate the token
CREATE POLICY "anon_can_validate_pending_token"
ON public.admin_invitations
FOR SELECT
TO anon, authenticated
USING (
  status = 'pending' 
  AND expires_at > now()
);

-- Policy 2: Admins can SELECT all invitations (for the admin panel invitations tab)
CREATE POLICY "admins_can_view_all_invitations"
ON public.admin_invitations
FOR SELECT
TO authenticated
USING (
  public.has_role(auth.uid(), 'admin')
);

-- Policy 3: Admins can INSERT new invitations
CREATE POLICY "admins_can_create_invitations"
ON public.admin_invitations
FOR INSERT
TO authenticated
WITH CHECK (
  public.has_role(auth.uid(), 'admin')
);

-- Policy 4: Admins can UPDATE invitations (e.g., mark as accepted)
CREATE POLICY "admins_can_update_invitations"
ON public.admin_invitations
FOR UPDATE
TO authenticated
USING (
  public.has_role(auth.uid(), 'admin')
);

-- Policy 5: Super admins can DELETE invitations
CREATE POLICY "super_admins_can_delete_invitations"
ON public.admin_invitations
FOR DELETE
TO authenticated
USING (
  public.is_super_admin()
);