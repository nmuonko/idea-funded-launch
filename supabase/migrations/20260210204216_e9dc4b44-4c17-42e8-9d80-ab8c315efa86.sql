
-- Add referred_by_code to profiles
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS referred_by_code text;
CREATE INDEX IF NOT EXISTS idx_profiles_referred_by_code ON public.profiles(referred_by_code) WHERE referred_by_code IS NOT NULL;

-- Referral codes table (one per user)
CREATE TABLE public.referral_codes (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL UNIQUE,
  code text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.referral_codes ENABLE ROW LEVEL SECURITY;

-- Users can read their own code
CREATE POLICY "Users can read own referral code" ON public.referral_codes
  FOR SELECT USING (auth.uid() = user_id);

-- Anyone can look up a code (for validation)
CREATE POLICY "Anyone can lookup codes" ON public.referral_codes
  FOR SELECT USING (true);

-- Users can insert their own code
CREATE POLICY "Users can create own referral code" ON public.referral_codes
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Referral events (click, signup, email_verified)
CREATE TABLE public.referral_events (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  ref_code text NOT NULL,
  event_type text NOT NULL CHECK (event_type IN ('click', 'signup', 'email_verified')),
  session_id text,
  referred_user_id uuid,
  metadata jsonb DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.referral_events ENABLE ROW LEVEL SECURITY;

-- Public insert for click events (anon), restrict reads to admins
CREATE POLICY "Anyone can insert click events" ON public.referral_events
  FOR INSERT WITH CHECK (event_type = 'click');

-- Admins can read all events (via service role), users can see their own referral events
CREATE POLICY "Users can read events for their code" ON public.referral_events
  FOR SELECT USING (
    ref_code IN (SELECT code FROM public.referral_codes WHERE user_id = auth.uid())
  );

-- Referral rewards
CREATE TABLE public.referral_rewards (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  referrer_user_id uuid NOT NULL,
  referred_user_id uuid NOT NULL UNIQUE, -- one reward per referred user (idempotency)
  ref_code text NOT NULL,
  amount_usd numeric(10,2) DEFAULT 0,
  reward_type text DEFAULT 'credit',
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'rejected')),
  paid_at timestamptz,
  paid_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.referral_rewards ENABLE ROW LEVEL SECURITY;

-- Users can see rewards they earned (as referrer)
CREATE POLICY "Users can read own rewards" ON public.referral_rewards
  FOR SELECT USING (auth.uid() = referrer_user_id);

-- Admin can manage rewards (via service role key in edge functions)

-- Trigger to update updated_at on referral_rewards
CREATE OR REPLACE FUNCTION public.update_referral_rewards_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_referral_rewards_updated_at
  BEFORE UPDATE ON public.referral_rewards
  FOR EACH ROW
  EXECUTE FUNCTION public.update_referral_rewards_updated_at();
