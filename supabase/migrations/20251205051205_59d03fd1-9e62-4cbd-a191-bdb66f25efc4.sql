-- Fix profiles table RLS vulnerability
-- The 'Block anonymous access' policy is PERMISSIVE, which when OR'd with ownership policies
-- allows ANY authenticated user to access ALL profiles.
-- Fix: Change to RESTRICTIVE so it AND's with ownership policies.

DROP POLICY IF EXISTS "Block anonymous access on profiles" ON profiles;

CREATE POLICY "Block anonymous access on profiles" ON profiles
  AS RESTRICTIVE FOR ALL TO public
  USING (auth.uid() IS NOT NULL);