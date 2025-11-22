-- Drop and recreate get_public_session_info to include new fields
DROP FUNCTION IF EXISTS public.get_public_session_info();

CREATE FUNCTION public.get_public_session_info()
RETURNS TABLE(
  id uuid, 
  name text, 
  start_date timestamp with time zone, 
  announcement_date timestamp with time zone, 
  status text, 
  desired_max_participants integer, 
  current_participant_count integer, 
  application_fee numeric, 
  currency text, 
  enable_waitlist boolean, 
  waitlist_count integer, 
  review_progress integer, 
  payment_instructions text,
  target_applicants integer,
  deadline_datetime timestamp with time zone
)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
    payment_instructions,
    target_applicants,
    deadline_datetime
  FROM public.sessions
  WHERE status IN ('open', 'closed', 'results_published')
  ORDER BY created_at DESC;
$function$;