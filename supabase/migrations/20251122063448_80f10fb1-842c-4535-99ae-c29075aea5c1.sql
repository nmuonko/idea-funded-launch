-- Fix admin_users RLS policy to prevent hanging queries
-- Drop the restrictive policy that's causing the hang
DROP POLICY IF EXISTS "Users can check their own admin status" ON public.admin_users;

-- Create a simpler policy that allows any authenticated user to check admin status
-- This is safe since the table only contains emails used for authentication checks
CREATE POLICY "Authenticated users can check admin status"
ON public.admin_users
FOR SELECT
TO authenticated
USING (true);

-- Keep the admin-only policies for insert/delete
-- These are already in place and working correctly