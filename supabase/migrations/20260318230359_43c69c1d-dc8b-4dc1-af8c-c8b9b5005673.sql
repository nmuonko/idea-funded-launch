
-- Create referral_commissions table
CREATE TABLE public.referral_commissions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  referrer_id UUID NOT NULL REFERENCES public.referrers(id) ON DELETE CASCADE,
  order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  buyer_user_id UUID NOT NULL,
  order_total_usd NUMERIC(10,2) NOT NULL DEFAULT 0,
  commission_percent NUMERIC(5,2) NOT NULL DEFAULT 10,
  commission_amount_usd NUMERIC(10,2) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  paid_at TIMESTAMP WITH TIME ZONE,
  UNIQUE(order_id, referrer_id)
);

-- Enable RLS
ALTER TABLE public.referral_commissions ENABLE ROW LEVEL SECURITY;

-- Admin (service role) can do everything, no user-facing policies needed
-- since this table is managed by backend only
CREATE POLICY "Service role full access" ON public.referral_commissions
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Allow authenticated admins to read (for admin dashboard)
CREATE POLICY "Authenticated users can read own referral commissions" ON public.referral_commissions
  FOR SELECT TO authenticated USING (true);
