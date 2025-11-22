-- Add AI analysis and fraud detection fields to user_submissions table
ALTER TABLE public.user_submissions
ADD COLUMN IF NOT EXISTS language_detected text,
ADD COLUMN IF NOT EXISTS project_description_raw text,
ADD COLUMN IF NOT EXISTS category text,
ADD COLUMN IF NOT EXISTS ai_summary text,
ADD COLUMN IF NOT EXISTS ai_strengths text,
ADD COLUMN IF NOT EXISTS ai_risks text,
ADD COLUMN IF NOT EXISTS ai_impact_score integer CHECK (ai_impact_score >= 1 AND ai_impact_score <= 10),
ADD COLUMN IF NOT EXISTS ai_feasibility_score integer CHECK (ai_feasibility_score >= 1 AND ai_feasibility_score <= 10),
ADD COLUMN IF NOT EXISTS ai_overall_score integer CHECK (ai_overall_score >= 1 AND ai_overall_score <= 10),
ADD COLUMN IF NOT EXISTS ai_feedback_short text,
ADD COLUMN IF NOT EXISTS ai_translation_en text,
ADD COLUMN IF NOT EXISTS ai_translation_fr text,
ADD COLUMN IF NOT EXISTS ai_translation_sw text,
ADD COLUMN IF NOT EXISTS ai_translation_ln text,
ADD COLUMN IF NOT EXISTS fraud_flags text,
ADD COLUMN IF NOT EXISTS is_suspected_fraud boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS is_possible_duplicate boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS duplicate_of_submission_id uuid REFERENCES public.user_submissions(id),
ADD COLUMN IF NOT EXISTS ai_last_reviewed_at timestamp with time zone,
ADD COLUMN IF NOT EXISTS status text DEFAULT 'submitted' CHECK (status IN ('submitted', 'shortlisted', 'winner', 'not_selected'));

-- Create index for fraud detection queries
CREATE INDEX IF NOT EXISTS idx_submissions_fraud ON public.user_submissions(is_suspected_fraud, is_possible_duplicate);

-- Create index for status queries
CREATE INDEX IF NOT EXISTS idx_submissions_status ON public.user_submissions(status);

-- Create index for duplicate detection
CREATE INDEX IF NOT EXISTS idx_submissions_duplicate ON public.user_submissions(duplicate_of_submission_id) WHERE duplicate_of_submission_id IS NOT NULL;