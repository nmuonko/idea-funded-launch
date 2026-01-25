-- Allow unauthenticated users to validate pending invitations by token
-- This is needed for the invitation acceptance flow before user creates account
CREATE POLICY "Anyone can validate pending invitations by token"
ON public.admin_invitations
FOR SELECT
TO anon, authenticated
USING (
  status = 'pending' 
  AND expires_at > now()
);

-- Also allow the invited user to update their invitation to 'accepted' status
-- after they create their account
CREATE POLICY "Newly created users can accept their invitation"
ON public.admin_invitations
FOR UPDATE
TO authenticated
USING (
  email = (SELECT email FROM auth.users WHERE id = auth.uid())
  AND status = 'pending'
)
WITH CHECK (
  status = 'accepted'
);