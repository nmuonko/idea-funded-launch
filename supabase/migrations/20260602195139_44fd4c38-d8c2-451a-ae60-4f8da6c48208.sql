CREATE POLICY "Admins can read all funnel logs"
ON public.checkout_funnel_log
FOR SELECT
USING (has_role(auth.uid(), 'admin'::app_role));

CREATE INDEX IF NOT EXISTS idx_checkout_funnel_log_created_at ON public.checkout_funnel_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_checkout_funnel_log_user_created ON public.checkout_funnel_log (user_id, created_at DESC);