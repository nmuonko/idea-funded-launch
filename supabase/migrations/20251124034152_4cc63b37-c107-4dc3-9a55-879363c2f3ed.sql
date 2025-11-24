-- Add MaishaPay payment tracking fields to user_submissions table

-- Add payment provider column
ALTER TABLE public.user_submissions 
ADD COLUMN IF NOT EXISTS payment_provider text DEFAULT 'maishapay';

-- Add payment currency column
ALTER TABLE public.user_submissions 
ADD COLUMN IF NOT EXISTS payment_currency text DEFAULT 'USD';

-- Add MaishaPay reference column (our internal reference)
ALTER TABLE public.user_submissions 
ADD COLUMN IF NOT EXISTS maishapay_reference text;

-- Add MaishaPay transaction ID column (ID returned by MaishaPay)
ALTER TABLE public.user_submissions 
ADD COLUMN IF NOT EXISTS maishapay_transaction_id text;

-- Add raw response for debugging
ALTER TABLE public.user_submissions 
ADD COLUMN IF NOT EXISTS maishapay_raw_response jsonb;

-- Add index on maishapay_reference for quick lookups
CREATE INDEX IF NOT EXISTS idx_user_submissions_maishapay_reference 
ON public.user_submissions(maishapay_reference);

-- Add index on maishapay_transaction_id
CREATE INDEX IF NOT EXISTS idx_user_submissions_maishapay_transaction_id 
ON public.user_submissions(maishapay_transaction_id);

-- Add comment for documentation
COMMENT ON COLUMN public.user_submissions.payment_provider IS 'Payment provider used (e.g., maishapay)';
COMMENT ON COLUMN public.user_submissions.payment_currency IS 'Currency for payment (e.g., USD, CDF)';
COMMENT ON COLUMN public.user_submissions.maishapay_reference IS 'Our internal reference for MaishaPay transaction';
COMMENT ON COLUMN public.user_submissions.maishapay_transaction_id IS 'Transaction ID returned by MaishaPay';
COMMENT ON COLUMN public.user_submissions.maishapay_raw_response IS 'Raw response from MaishaPay for debugging';