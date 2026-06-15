
-- payment_cta_clicks: tighten INSERT
DROP POLICY IF EXISTS "anyone can insert cta click" ON public.payment_cta_clicks;

CREATE POLICY "anon can insert guest cta clicks"
  ON public.payment_cta_clicks
  FOR INSERT
  TO anon
  WITH CHECK (
    actor_role = 'guest'
    AND user_id IS NULL
    AND admin_id IS NULL
  );

CREATE POLICY "authenticated can insert own cta clicks"
  ON public.payment_cta_clicks
  FOR INSERT
  TO authenticated
  WITH CHECK (
    (
      actor_role = 'customer'
      AND admin_id IS NULL
      AND (user_id IS NULL OR user_id = auth.uid())
    )
    OR (
      actor_role = 'admin'
      AND user_id IS NULL
      AND admin_id = auth.uid()
      AND public.has_role(auth.uid(), 'admin'::public.app_role)
    )
    OR (
      actor_role = 'guest'
      AND user_id IS NULL
      AND admin_id IS NULL
    )
  );

-- chatbot_payment_escalations: require auth and own row
DROP POLICY IF EXISTS "anyone can insert payment escalation" ON public.chatbot_payment_escalations;

CREATE POLICY "authenticated insert own payment escalation"
  ON public.chatbot_payment_escalations
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id IS NULL OR user_id = auth.uid());

-- hot_product_clicks: bind user_id to caller
DROP POLICY IF EXISTS "Anyone can insert hot product clicks" ON public.hot_product_clicks;

CREATE POLICY "anon insert anonymous hot product clicks"
  ON public.hot_product_clicks
  FOR INSERT
  TO anon
  WITH CHECK (user_id IS NULL);

CREATE POLICY "authenticated insert own hot product clicks"
  ON public.hot_product_clicks
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id IS NULL OR user_id = auth.uid());

-- referral_events: bind user_id to caller for click events
DROP POLICY IF EXISTS "Anyone can insert click events" ON public.referral_events;

CREATE POLICY "anon insert anonymous click events"
  ON public.referral_events
  FOR INSERT
  TO anon
  WITH CHECK (event_type = 'click' AND user_id IS NULL);

CREATE POLICY "authenticated insert own click events"
  ON public.referral_events
  FOR INSERT
  TO authenticated
  WITH CHECK (
    event_type = 'click'
    AND (user_id IS NULL OR user_id = auth.uid())
  );

-- payment_providers: stop exposing secret_refs to client roles.
-- Service role still has full access for edge functions.
REVOKE SELECT (secret_refs) ON public.payment_providers FROM anon;
REVOKE SELECT (secret_refs) ON public.payment_providers FROM authenticated;
