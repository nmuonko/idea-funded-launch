
-- Create referral_payouts table
CREATE TABLE public.referral_payouts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  referrer_id UUID NOT NULL REFERENCES public.referrers(id) ON DELETE CASCADE,
  amount_usd NUMERIC(10,2) NOT NULL,
  phone TEXT NOT NULL,
  correspondent TEXT NOT NULL,
  pawapay_payout_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  commission_ids UUID[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  failure_reason TEXT
);

-- Index for lookups
CREATE INDEX idx_referral_payouts_referrer ON public.referral_payouts(referrer_id);
CREATE INDEX idx_referral_payouts_status ON public.referral_payouts(status);
CREATE INDEX idx_referral_payouts_pawapay_id ON public.referral_payouts(pawapay_payout_id);

-- RLS
ALTER TABLE public.referral_payouts ENABLE ROW LEVEL SECURITY;

-- Admin-only access (service role bypasses RLS)
CREATE POLICY "Admin access only" ON public.referral_payouts FOR ALL TO authenticated
  USING (false) WITH CHECK (false);
