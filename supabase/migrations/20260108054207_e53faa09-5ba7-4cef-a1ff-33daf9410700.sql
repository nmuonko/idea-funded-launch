
-- Fix the overly permissive service role policy
-- Drop the permissive policy and replace with a more restrictive one
DROP POLICY IF EXISTS "Service role can insert any message" ON public.thread_messages;

-- AI messages should only be inserted by service role (handled internally)
-- The existing admin policy already allows admins to insert 'ai' messages
-- No additional policy needed since service role bypasses RLS
