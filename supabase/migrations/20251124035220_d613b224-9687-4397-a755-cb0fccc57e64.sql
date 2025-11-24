-- Add policy to allow viewing recent submissions (within 5 minutes of creation)
-- This allows users to see their submission immediately after creating it
-- and proceed to payment without RLS errors
CREATE POLICY "Anyone can view recent submissions"
ON public.user_submissions
FOR SELECT
TO public
USING (
  created_at > (now() - interval '5 minutes')
);