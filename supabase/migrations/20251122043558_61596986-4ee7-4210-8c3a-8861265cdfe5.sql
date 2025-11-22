-- Add submission type and draft/payment tracking fields
ALTER TABLE public.user_submissions
ADD COLUMN IF NOT EXISTS submission_type TEXT DEFAULT 'text' CHECK (submission_type IN ('text', 'voice')),
ADD COLUMN IF NOT EXISTS is_draft BOOLEAN DEFAULT true,
ADD COLUMN IF NOT EXISTS preferred_language TEXT,
ADD COLUMN IF NOT EXISTS amount_due NUMERIC DEFAULT 20;

-- Add voice recording fields (audio URLs)
ALTER TABLE public.user_submissions
ADD COLUMN IF NOT EXISTS project_title_voice_audio_url TEXT,
ADD COLUMN IF NOT EXISTS project_description_voice_audio_url TEXT,
ADD COLUMN IF NOT EXISTS problem_voice_audio_url TEXT,
ADD COLUMN IF NOT EXISTS audience_voice_audio_url TEXT,
ADD COLUMN IF NOT EXISTS feasibility_voice_audio_url TEXT,
ADD COLUMN IF NOT EXISTS budget_voice_audio_url TEXT,
ADD COLUMN IF NOT EXISTS impact_voice_audio_url TEXT,
ADD COLUMN IF NOT EXISTS why_voice_audio_url TEXT;

-- Add voice transcription text fields (editable by user)
ALTER TABLE public.user_submissions
ADD COLUMN IF NOT EXISTS project_title_voice_text TEXT,
ADD COLUMN IF NOT EXISTS project_description_voice_text TEXT,
ADD COLUMN IF NOT EXISTS problem_voice_text TEXT,
ADD COLUMN IF NOT EXISTS audience_voice_text TEXT,
ADD COLUMN IF NOT EXISTS feasibility_voice_text TEXT,
ADD COLUMN IF NOT EXISTS budget_voice_text TEXT,
ADD COLUMN IF NOT EXISTS impact_voice_text TEXT,
ADD COLUMN IF NOT EXISTS why_voice_text TEXT;

-- Add additional question fields to match the new structure
ALTER TABLE public.user_submissions
ADD COLUMN IF NOT EXISTS problem_to_solve TEXT,
ADD COLUMN IF NOT EXISTS target_audience TEXT,
ADD COLUMN IF NOT EXISTS feasibility_explanation_extended TEXT,
ADD COLUMN IF NOT EXISTS budget_details TEXT,
ADD COLUMN IF NOT EXISTS expected_impact TEXT,
ADD COLUMN IF NOT EXISTS why_selected TEXT;

-- Update sessions table for progress tracking
ALTER TABLE public.sessions
ADD COLUMN IF NOT EXISTS target_applicants INTEGER DEFAULT 500,
ADD COLUMN IF NOT EXISTS deadline_datetime TIMESTAMP WITH TIME ZONE;

-- Create index for project_code lookups (already exists but ensure it's there)
CREATE INDEX IF NOT EXISTS idx_user_submissions_project_code ON public.user_submissions(project_code);

-- Create index for draft/paid filtering
CREATE INDEX IF NOT EXISTS idx_user_submissions_draft_paid ON public.user_submissions(is_draft, payment_status);

-- Create index for submission type analytics
CREATE INDEX IF NOT EXISTS idx_user_submissions_type ON public.user_submissions(submission_type);

-- Update RLS policies to allow public project code lookup
DROP POLICY IF EXISTS "Anyone can search by project code" ON public.user_submissions;
CREATE POLICY "Anyone can search by project code"
ON public.user_submissions
FOR SELECT
USING (project_code IS NOT NULL);

-- Function to get public session info including progress
CREATE OR REPLACE FUNCTION public.get_session_progress(session_uuid UUID)
RETURNS TABLE(
  session_name TEXT,
  target_applicants INTEGER,
  current_count BIGINT,
  progress_percentage NUMERIC,
  deadline_datetime TIMESTAMP WITH TIME ZONE,
  status TEXT
) 
LANGUAGE SQL
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT 
    s.name,
    s.target_applicants,
    COUNT(us.id) FILTER (WHERE us.payment_status = 'paid' AND us.is_draft = false) as current_count,
    CASE 
      WHEN s.target_applicants > 0 THEN 
        ROUND((COUNT(us.id) FILTER (WHERE us.payment_status = 'paid' AND us.is_draft = false)::NUMERIC / s.target_applicants::NUMERIC) * 100, 1)
      ELSE 0
    END as progress_percentage,
    s.deadline_datetime,
    s.status::TEXT
  FROM public.sessions s
  LEFT JOIN public.user_submissions us ON us.session_id = s.id
  WHERE s.id = session_uuid
  GROUP BY s.id, s.name, s.target_applicants, s.deadline_datetime, s.status;
$$;