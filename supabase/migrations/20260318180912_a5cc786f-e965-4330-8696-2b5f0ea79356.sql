CREATE TABLE public.checkout_funnel_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  session_id UUID,
  order_id UUID,
  step TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ok',
  error_message TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_checkout_funnel_log_user_id ON public.checkout_funnel_log(user_id);
CREATE INDEX idx_checkout_funnel_log_session_id ON public.checkout_funnel_log(session_id);
CREATE INDEX idx_checkout_funnel_log_step ON public.checkout_funnel_log(step);
CREATE INDEX idx_checkout_funnel_log_created_at ON public.checkout_funnel_log(created_at DESC);

ALTER TABLE public.checkout_funnel_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can insert their own funnel logs"
  ON public.checkout_funnel_log
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can read their own funnel logs"
  ON public.checkout_funnel_log
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Anon can insert funnel logs"
  ON public.checkout_funnel_log
  FOR INSERT
  TO anon
  WITH CHECK (true);

CREATE POLICY "Service role full access to funnel logs"
  ON public.checkout_funnel_log
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);