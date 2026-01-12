-- Fix RLS policy: Remove overly permissive service role policy
-- Edge functions use service role which bypasses RLS anyway
DROP POLICY IF EXISTS "Service role can manage payment settings" ON public.payment_settings;

-- No insert/update/delete for regular users
-- The existing policies are sufficient:
-- - "Authenticated users can read" for SELECT
-- - "Admins can update" for UPDATE
-- - "Admins can insert" for INSERT

-- Note: Service role bypasses RLS, so edge functions can still read/write