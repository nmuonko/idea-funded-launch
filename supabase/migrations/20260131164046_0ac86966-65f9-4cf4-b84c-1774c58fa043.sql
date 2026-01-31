-- Add last_heartbeat column to prewarm_jobs for stall detection
ALTER TABLE public.prewarm_jobs ADD COLUMN IF NOT EXISTS last_heartbeat timestamptz DEFAULT now();

-- Create an index for finding stalled jobs
CREATE INDEX IF NOT EXISTS idx_prewarm_jobs_stall_detection ON public.prewarm_jobs (status, last_heartbeat) WHERE status = 'processing';