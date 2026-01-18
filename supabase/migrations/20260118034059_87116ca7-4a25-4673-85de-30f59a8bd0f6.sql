-- Add user_email column to price_confirmations for admin convenience
ALTER TABLE public.price_confirmations 
ADD COLUMN IF NOT EXISTS user_email TEXT;

-- Add comment for documentation
COMMENT ON COLUMN public.price_confirmations.user_email IS 'User email at time of submission for admin display convenience';

-- Create index for user_email lookup
CREATE INDEX IF NOT EXISTS idx_price_confirmations_user_email 
ON public.price_confirmations(user_email) WHERE user_email IS NOT NULL;