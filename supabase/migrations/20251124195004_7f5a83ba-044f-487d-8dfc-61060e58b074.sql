-- Add confirmation ID and submission tracking fields to user_submissions
ALTER TABLE public.user_submissions
ADD COLUMN IF NOT EXISTS confirmation_id TEXT UNIQUE,
ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS payment_ref_id TEXT,
ADD COLUMN IF NOT EXISTS payment_operator_id TEXT;

-- Create index on confirmation_id for fast lookups
CREATE INDEX IF NOT EXISTS idx_user_submissions_confirmation_id 
ON public.user_submissions(confirmation_id);

-- Add comment explaining the confirmation ID format
COMMENT ON COLUMN public.user_submissions.confirmation_id IS 
'Unique confirmation ID in format AFF-YYYYMMDD-XXXXXXXX used for tracking application status';

COMMENT ON COLUMN public.user_submissions.submitted_at IS 
'Timestamp when project was officially submitted (after successful payment)';

COMMENT ON COLUMN public.user_submissions.payment_ref_id IS 
'MaishaPay transaction reference ID';

COMMENT ON COLUMN public.user_submissions.payment_operator_id IS 
'MaishaPay operator reference ID';
