-- Fix admin_users table RLS bypass vulnerability
-- The "Block anonymous access on admin_users" policy is PERMISSIVE, 
-- causing it to OR with other policies instead of AND.
-- Any authenticated user can currently view all admin emails.

-- Step 1: Drop the problematic PERMISSIVE policy
DROP POLICY IF EXISTS "Block anonymous access on admin_users" ON admin_users;

-- Step 2: Recreate as RESTRICTIVE policy (AND's with other policies)
CREATE POLICY "Block anonymous access on admin_users" ON admin_users
  AS RESTRICTIVE FOR ALL TO public
  USING (auth.uid() IS NOT NULL);