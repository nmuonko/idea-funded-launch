
-- Atomic queue claim with SKIP LOCKED to prevent double-processing
CREATE OR REPLACE FUNCTION public.claim_refresh_queue_jobs(
  p_max_jobs integer DEFAULT 10,
  p_lock_id text DEFAULT gen_random_uuid()::text
)
RETURNS SETOF public.catalog_refresh_queue
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  RETURN QUERY
  WITH claimed AS (
    SELECT id
    FROM public.catalog_refresh_queue
    WHERE status = 'queued'
      AND scheduled_at <= now()
    ORDER BY priority ASC, scheduled_at ASC
    LIMIT p_max_jobs
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.catalog_refresh_queue q
  SET 
    status = 'running',
    locked_at = now(),
    locked_by = p_lock_id
  FROM claimed
  WHERE q.id = claimed.id
  RETURNING q.*;
END;
$$;
