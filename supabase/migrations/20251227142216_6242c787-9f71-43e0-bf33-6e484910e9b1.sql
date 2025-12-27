-- Fix the overly permissive admin_invitations RLS policy
-- This policy was allowing ANY user to enumerate all pending invitations

-- Drop the vulnerable policy
DROP POLICY IF EXISTS "Anyone can view their pending invitation by token" ON public.admin_invitations;

-- Create a secure policy that requires authentication and email matching
-- Users can only see invitations for their own email address
CREATE POLICY "Users can view their own pending invitations by email" 
  ON public.admin_invitations
  FOR SELECT USING (
    auth.uid() IS NOT NULL
    AND status = 'pending' 
    AND expires_at > now()
    AND email = (SELECT email FROM auth.users WHERE id = auth.uid())
  );