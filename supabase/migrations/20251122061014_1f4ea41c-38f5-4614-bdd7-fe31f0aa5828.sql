-- Drop and recreate get_active_session with all needed fields
DROP FUNCTION IF EXISTS public.get_active_session();

CREATE FUNCTION public.get_active_session()
RETURNS TABLE(
  id uuid,
  name text,
  start_date timestamp with time zone,
  deadline_datetime timestamp with time zone,
  target_applicants integer,
  desired_max_participants integer,
  current_participant_count integer,
  review_progress integer,
  status text,
  is_active boolean
) 
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT 
    id,
    name,
    start_date,
    deadline_datetime,
    target_applicants,
    desired_max_participants,
    current_participant_count,
    review_progress,
    status::text,
    is_active
  FROM public.sessions
  WHERE is_active = true
  LIMIT 1;
$$
LANGUAGE sql;