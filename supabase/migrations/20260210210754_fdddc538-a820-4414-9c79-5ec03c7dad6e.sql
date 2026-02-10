
-- ==============================================
-- NEW REFERRAL SYSTEM: Replace old Share & Earn
-- ==============================================

-- 1) Create referrers table
CREATE TABLE IF NOT EXISTS public.referrers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name text NOT NULL,
  email text NOT NULL UNIQUE,
  phone text NOT NULL,
  ref_code text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.referrers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admin full access to referrers" ON public.referrers FOR ALL USING (true);

-- 2) Adapt referral_events: add anon_session_id column, rename session_id if exists, add user_id
ALTER TABLE public.referral_events ADD COLUMN IF NOT EXISTS anon_session_id text;
ALTER TABLE public.referral_events ADD COLUMN IF NOT EXISTS user_id uuid;
ALTER TABLE public.referral_events ADD COLUMN IF NOT EXISTS meta jsonb DEFAULT '{}'::jsonb;
-- Create index for fast lookups
CREATE INDEX IF NOT EXISTS idx_referral_events_ref_code_type ON public.referral_events (ref_code, event_type, created_at);
CREATE INDEX IF NOT EXISTS idx_referral_events_user_id ON public.referral_events (user_id);

-- 3) Adapt referral_rewards: add referrer_id column referencing referrers
ALTER TABLE public.referral_rewards ADD COLUMN IF NOT EXISTS referrer_id uuid REFERENCES public.referrers(id);

-- 4) Create referral_payout_rules table
CREATE TABLE IF NOT EXISTS public.referral_payout_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  threshold_verified_count int NOT NULL,
  payout_amount_usd numeric NOT NULL,
  is_enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.referral_payout_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admin full access to payout_rules" ON public.referral_payout_rules FOR ALL USING (true);

-- Insert default rule
INSERT INTO public.referral_payout_rules (threshold_verified_count, payout_amount_usd)
VALUES (10, 5.00)
ON CONFLICT DO NOTHING;

-- 5) Create referral_payout_claims table
CREATE TABLE IF NOT EXISTS public.referral_payout_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_id uuid NOT NULL REFERENCES public.referrers(id),
  ref_code text NOT NULL,
  rule_id uuid NOT NULL REFERENCES public.referral_payout_rules(id),
  verified_count_at_trigger int NOT NULL,
  payout_amount_usd numeric NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  paid_at timestamptz
);
ALTER TABLE public.referral_payout_claims ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admin full access to payout_claims" ON public.referral_payout_claims FOR ALL USING (true);

-- Unique constraint to prevent duplicate claims per referrer+rule
CREATE UNIQUE INDEX IF NOT EXISTS idx_payout_claims_unique ON public.referral_payout_claims (referrer_id, rule_id);

-- 6) Ensure admin_settings has ADMIN_ALERT_EMAIL
INSERT INTO public.admin_settings (key, value)
VALUES ('ADMIN_ALERT_EMAIL', 'nkadimisha@afrishop-usa.com')
ON CONFLICT (key) DO NOTHING;

-- 7) Drop old referral_codes table (no longer needed)
DROP TABLE IF EXISTS public.referral_codes CASCADE;
