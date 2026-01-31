-- Create prewarm_jobs table to track background prewarm jobs
CREATE TABLE public.prewarm_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  status text NOT NULL DEFAULT 'pending',  -- pending, processing, completed, failed
  rotation_key text,
  sections_total integer DEFAULT 0,
  sections_completed integer DEFAULT 0,
  current_section text,
  amazon_fetched integer DEFAULT 0,
  ebay_fetched integer DEFAULT 0,
  mixed_total integer DEFAULT 0,
  error_message text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz DEFAULT now()
);

-- Index for finding pending/processing jobs
CREATE INDEX idx_prewarm_jobs_status ON public.prewarm_jobs(status);
CREATE INDEX idx_prewarm_jobs_created_at ON public.prewarm_jobs(created_at DESC);

-- Enable RLS
ALTER TABLE public.prewarm_jobs ENABLE ROW LEVEL SECURITY;

-- Admins can read all prewarm jobs
CREATE POLICY "Admins can view prewarm jobs"
ON public.prewarm_jobs
FOR SELECT
USING (public.is_admin_role());

-- Service role can manage prewarm jobs (edge functions)
CREATE POLICY "Service role can manage prewarm jobs"
ON public.prewarm_jobs
FOR ALL
USING (true)
WITH CHECK (true);

-- Comment
COMMENT ON TABLE public.prewarm_jobs IS 'Tracks background home prewarm job status and progress';