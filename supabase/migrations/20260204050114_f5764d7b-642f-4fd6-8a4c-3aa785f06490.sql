-- Create invitation attempts tracking table for rate limiting
CREATE TABLE IF NOT EXISTS public.invitation_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ip_address text NOT NULL,
  token_hash text NOT NULL,
  success boolean DEFAULT false,
  attempted_at timestamptz DEFAULT now()
);

-- Index for efficient rate limit queries by IP
CREATE INDEX IF NOT EXISTS idx_invitation_attempts_ip_time 
ON public.invitation_attempts(ip_address, attempted_at);

-- Index for tracking specific token attempts
CREATE INDEX IF NOT EXISTS idx_invitation_attempts_token_time 
ON public.invitation_attempts(token_hash, attempted_at);

-- Enable RLS
ALTER TABLE public.invitation_attempts ENABLE ROW LEVEL SECURITY;

-- Only service role can insert (from edge functions)
CREATE POLICY "Service role can insert invitation attempts"
ON public.invitation_attempts
FOR INSERT
TO service_role
WITH CHECK (true);

-- Only service role can read (for rate limit checks)
CREATE POLICY "Service role can read invitation attempts"
ON public.invitation_attempts
FOR SELECT
TO service_role
USING (true);

-- Function to cleanup old invitation attempts (older than 24 hours)
CREATE OR REPLACE FUNCTION public.cleanup_invitation_attempts()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_deleted_count integer;
BEGIN
  DELETE FROM public.invitation_attempts 
  WHERE attempted_at < now() - interval '24 hours';
  
  GET DIAGNOSTICS v_deleted_count = ROW_COUNT;
  
  RETURN jsonb_build_object(
    'success', true,
    'deleted_count', v_deleted_count,
    'cleanup_at', now()
  );
END;
$function$;

-- Add comment for documentation
COMMENT ON TABLE public.invitation_attempts IS 'Tracks invitation acceptance attempts for rate limiting to prevent token enumeration attacks';