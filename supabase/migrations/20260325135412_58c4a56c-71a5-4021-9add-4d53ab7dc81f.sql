
ALTER TABLE public.hot_product_campaigns ADD COLUMN IF NOT EXISTS error_message text;

CREATE TABLE IF NOT EXISTS public.hot_product_delivery_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES public.hot_product_campaigns(id) ON DELETE CASCADE,
  recipient_email text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  provider_message_id text,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_delivery_logs_campaign ON public.hot_product_delivery_logs(campaign_id);

ALTER TABLE public.hot_product_delivery_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view delivery logs"
  ON public.hot_product_delivery_logs
  FOR SELECT
  TO authenticated
  USING (public.is_admin(auth.uid()));

CREATE POLICY "Service role can insert delivery logs"
  ON public.hot_product_delivery_logs
  FOR INSERT
  TO service_role
  WITH CHECK (true);

CREATE POLICY "Service role can update delivery logs"
  ON public.hot_product_delivery_logs
  FOR UPDATE
  TO service_role
  USING (true)
  WITH CHECK (true);
