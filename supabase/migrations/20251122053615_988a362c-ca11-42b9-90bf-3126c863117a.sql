-- Drop the restrictive policy on admin_users
DROP POLICY IF EXISTS "Only admins can view admin users" ON public.admin_users;

-- Allow authenticated users to check if their email exists in admin_users
-- This is safe because users can only see if THEIR email is in the table
CREATE POLICY "Users can check their own admin status"
ON public.admin_users
FOR SELECT
TO authenticated
USING (email = auth.jwt()->>'email');

-- Keep admin-only policies for INSERT and DELETE
-- (These should already exist, but let's make sure)
DROP POLICY IF EXISTS "Only admins can insert admin users" ON public.admin_users;
DROP POLICY IF EXISTS "Only admins can delete admin users" ON public.admin_users;

CREATE POLICY "Only admins can insert admin users"
ON public.admin_users
FOR INSERT
TO authenticated
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Only admins can delete admin users"
ON public.admin_users
FOR DELETE
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role));