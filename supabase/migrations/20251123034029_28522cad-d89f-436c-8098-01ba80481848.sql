-- Fix contact_messages SELECT policy to prevent infinite recursion
DROP POLICY IF EXISTS "Only admins can view contact messages" ON public.contact_messages;

CREATE POLICY "Only admins can view contact messages"
ON public.contact_messages
FOR SELECT
TO public
USING (
  EXISTS (
    SELECT 1 FROM public.user_roles 
    WHERE user_id = auth.uid() 
    AND role = 'admin'::app_role
  )
);

-- Fix user_submissions UPDATE policy to prevent infinite recursion
DROP POLICY IF EXISTS "Only admins can update submissions" ON public.user_submissions;

CREATE POLICY "Only admins can update submissions"
ON public.user_submissions
FOR UPDATE
TO public
USING (
  EXISTS (
    SELECT 1 FROM public.user_roles 
    WHERE user_id = auth.uid() 
    AND role = 'admin'::app_role
  )
);