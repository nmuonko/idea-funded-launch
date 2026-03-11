
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS cart_reminder_2_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancel_reason text;
