-- 1) Allow the full referral funnel event types
ALTER TABLE public.referral_events
  DROP CONSTRAINT IF EXISTS referral_events_event_type_check;

ALTER TABLE public.referral_events
  ADD CONSTRAINT referral_events_event_type_check
  CHECK (event_type = ANY (ARRAY[
    'click','signup','email_verified',
    'add_to_cart','payment_initiated','purchase'
  ]));

-- 2) Replace insert policies so anon + authenticated users can record funnel events
DROP POLICY IF EXISTS "anon insert anonymous click events" ON public.referral_events;
DROP POLICY IF EXISTS "authenticated insert own click events" ON public.referral_events;

CREATE POLICY "anon insert anonymous funnel events"
  ON public.referral_events
  FOR INSERT TO anon
  WITH CHECK (
    event_type = ANY (ARRAY['click','add_to_cart','payment_initiated'])
    AND user_id IS NULL
  );

CREATE POLICY "authenticated insert own funnel events"
  ON public.referral_events
  FOR INSERT TO authenticated
  WITH CHECK (
    event_type = ANY (ARRAY['click','add_to_cart','payment_initiated'])
    AND (user_id IS NULL OR user_id = auth.uid())
  );

-- 3) Default new commissions to 3% (existing rows unchanged)
ALTER TABLE public.referral_commissions
  ALTER COLUMN commission_percent SET DEFAULT 3;