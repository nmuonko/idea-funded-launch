
-- Step 2: Extend referral_payout_rules with reward type columns
ALTER TABLE public.referral_payout_rules
  ADD COLUMN reward_type text NOT NULL DEFAULT 'cash',
  ADD COLUMN data_mb integer,
  ADD COLUMN airtime_amount numeric,
  ADD COLUMN operator_country_code text NOT NULL DEFAULT 'CD';

-- Add check constraint for reward_type
ALTER TABLE public.referral_payout_rules
  ADD CONSTRAINT chk_reward_type CHECK (reward_type IN ('cash', 'data', 'airtime'));

-- Step 6: Create referral_topup_log table
CREATE TABLE public.referral_topup_log (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  claim_id uuid REFERENCES public.referral_payout_claims(id),
  referrer_id uuid NOT NULL,
  phone text NOT NULL,
  operator_name text,
  operator_id text,
  topup_type text NOT NULL DEFAULT 'data',
  amount numeric,
  data_mb integer,
  reloadly_tx_id text,
  status text NOT NULL DEFAULT 'pending',
  error_message text,
  country_code text DEFAULT 'CD',
  raw_response jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.referral_topup_log ENABLE ROW LEVEL SECURITY;

-- Only admins can read topup logs
CREATE POLICY "Admins can view topup logs"
  ON public.referral_topup_log FOR SELECT
  USING (public.is_admin());

-- Only service role can insert (edge functions)
CREATE POLICY "Service role can insert topup logs"
  ON public.referral_topup_log FOR INSERT
  WITH CHECK (true);

-- Add delivery_status column to referral_payout_claims
ALTER TABLE public.referral_payout_claims
  ADD COLUMN delivery_status text DEFAULT 'pending',
  ADD COLUMN delivery_tx_id text,
  ADD COLUMN delivery_error text;
