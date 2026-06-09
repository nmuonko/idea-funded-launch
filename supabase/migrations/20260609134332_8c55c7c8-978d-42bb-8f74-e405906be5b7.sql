
-- Track sent pending-payment reminders so we never re-send the same attempt
CREATE TABLE IF NOT EXISTS public.payment_pending_reminders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  attempt_number int NOT NULL CHECK (attempt_number BETWEEN 1 AND 9),
  scheduled_for timestamptz NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT now(),
  channel text NOT NULL DEFAULT 'email',
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(order_id, attempt_number)
);

GRANT SELECT ON public.payment_pending_reminders TO authenticated;
GRANT ALL ON public.payment_pending_reminders TO service_role;

ALTER TABLE public.payment_pending_reminders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role manages reminders"
ON public.payment_pending_reminders FOR ALL
USING (auth.role() = 'service_role')
WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "Users view their own reminders"
ON public.payment_pending_reminders FOR SELECT
TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.orders o
  WHERE o.id = payment_pending_reminders.order_id
    AND o.user_id = auth.uid()
));

CREATE INDEX IF NOT EXISTS payment_pending_reminders_order_idx
  ON public.payment_pending_reminders(order_id);

-- Schedule the cron (every 30 minutes)
DO $$
DECLARE
  v_url text := 'https://igmkhxffnyzoogcqvdab.supabase.co/functions/v1/send-pending-payment-reminders';
  v_secret text;
BEGIN
  -- Best-effort: read cron secret from vault if present
  BEGIN
    SELECT decrypted_secret INTO v_secret
    FROM vault.decrypted_secrets WHERE name = 'CRON_SECRET' LIMIT 1;
  EXCEPTION WHEN OTHERS THEN
    v_secret := NULL;
  END;

  PERFORM cron.unschedule('send-pending-payment-reminders-30min')
    WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'send-pending-payment-reminders-30min');

  PERFORM cron.schedule(
    'send-pending-payment-reminders-30min',
    '*/30 * * * *',
    format(
      $cmd$
      SELECT net.http_post(
        url := %L,
        headers := %L::jsonb,
        body := '{}'::jsonb
      );
      $cmd$,
      v_url,
      jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-secret', COALESCE(v_secret, '')
      )::text
    )
  );
END $$;
