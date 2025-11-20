-- Add new fields to user_submissions table for enhanced payment tracking and project categorization
ALTER TABLE public.user_submissions 
ADD COLUMN IF NOT EXISTS country text,
ADD COLUMN IF NOT EXISTS project_type text,
ADD COLUMN IF NOT EXISTS payment_phone_number text,
ADD COLUMN IF NOT EXISTS payment_amount numeric,
ADD COLUMN IF NOT EXISTS payment_reference text;

-- Add index for better query performance
CREATE INDEX IF NOT EXISTS idx_user_submissions_session_id ON public.user_submissions(session_id);
CREATE INDEX IF NOT EXISTS idx_user_submissions_payment_status ON public.user_submissions(payment_status);
CREATE INDEX IF NOT EXISTS idx_user_submissions_submission_status ON public.user_submissions(submission_status);

-- Add sessions configuration fields for payment settings
ALTER TABLE public.sessions
ADD COLUMN IF NOT EXISTS application_fee numeric DEFAULT 0,
ADD COLUMN IF NOT EXISTS currency text DEFAULT 'USD',
ADD COLUMN IF NOT EXISTS airtel_money_number text,
ADD COLUMN IF NOT EXISTS m_pesa_number text,
ADD COLUMN IF NOT EXISTS orange_money_number text,
ADD COLUMN IF NOT EXISTS afrimoney_number text,
ADD COLUMN IF NOT EXISTS payment_instructions text,
ADD COLUMN IF NOT EXISTS enable_waitlist boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS waitlist_count integer DEFAULT 0;