-- Fix admin_invitations RLS policies - they should be PERMISSIVE, not RESTRICTIVE
-- Currently ALL policies are RESTRICTIVE which means they all must pass simultaneously
-- This causes zero results because the conditions conflict

-- Drop the problematic RESTRICTIVE SELECT policies
DROP POLICY IF EXISTS "admins_can_view_all_invitations" ON public.admin_invitations;
DROP POLICY IF EXISTS "anon_can_validate_pending_token" ON public.admin_invitations;
DROP POLICY IF EXISTS "Admins can view invitations they sent" ON public.admin_invitations;
DROP POLICY IF EXISTS "Users can accept their own pending invitations" ON public.admin_invitations;
DROP POLICY IF EXISTS "Users can view their own pending invitations by email" ON public.admin_invitations;

-- Recreate as PERMISSIVE policies (default, any one passing grants access)
-- Policy 1: Admins can view ALL invitations (for admin panel)
CREATE POLICY "admins_can_view_all_invitations"
ON public.admin_invitations
FOR SELECT
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role));

-- Policy 2: Anonymous users can validate pending tokens (for accept-invite page)
CREATE POLICY "anon_can_validate_pending_token"
ON public.admin_invitations
FOR SELECT
TO anon, authenticated
USING (status = 'pending' AND expires_at > now());

-- Now the INSERT/UPDATE/DELETE policies - these should stay RESTRICTIVE for security
-- Drop and recreate INSERT policies correctly
DROP POLICY IF EXISTS "admins_can_create_invitations" ON public.admin_invitations;
DROP POLICY IF EXISTS "Admins can create invitations" ON public.admin_invitations;

CREATE POLICY "admins_can_create_invitations"
ON public.admin_invitations
FOR INSERT
TO authenticated
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- Drop and recreate UPDATE policies
DROP POLICY IF EXISTS "admins_can_update_invitations" ON public.admin_invitations;
DROP POLICY IF EXISTS "Admins can update invitations" ON public.admin_invitations;
DROP POLICY IF EXISTS "Newly created users can accept their invitation" ON public.admin_invitations;

CREATE POLICY "admins_can_update_invitations"
ON public.admin_invitations
FOR UPDATE
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role));

-- Allow newly created users to mark their own invitation as accepted
CREATE POLICY "users_can_accept_own_invitation"
ON public.admin_invitations
FOR UPDATE
TO authenticated
USING (
  email = (SELECT email FROM auth.users WHERE id = auth.uid())::text 
  AND status = 'pending'
)
WITH CHECK (status = 'accepted');

-- Keep super admin delete policy
DROP POLICY IF EXISTS "super_admins_can_delete_invitations" ON public.admin_invitations;

CREATE POLICY "super_admins_can_delete_invitations"
ON public.admin_invitations
FOR DELETE
TO authenticated
USING (is_super_admin());