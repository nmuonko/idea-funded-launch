-- Drop the public SELECT policy on sessions
DROP POLICY IF EXISTS "Anyone can view sessions" ON public.sessions;

-- Create admin-only SELECT policy for sessions
CREATE POLICY "Only admins can view sessions"
ON public.sessions
FOR SELECT
USING (public.has_role(auth.uid(), 'admin'));

-- Create a secure function that returns only non-sensitive session data for public use
CREATE OR REPLACE FUNCTION public.get_public_session_info()
RETURNS TABLE (
  id UUID,
  name TEXT,
  start_date TIMESTAMPTZ,
  announcement_date TIMESTAMPTZ,
  status TEXT,
  desired_max_participants INT,
  current_participant_count INT,
  application_fee NUMERIC,
  currency TEXT,
  enable_waitlist BOOLEAN,
  waitlist_count INT,
  review_progress INT,
  payment_instructions TEXT
)
LANGUAGE SQL
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT 
    id,
    name,
    start_date,
    announcement_date,
    status::TEXT,
    desired_max_participants,
    current_participant_count,
    application_fee,
    currency,
    enable_waitlist,
    waitlist_count,
    review_progress,
    payment_instructions
  FROM public.sessions
  WHERE status IN ('open', 'closed', 'results_published')
  ORDER BY created_at DESC;
$$;