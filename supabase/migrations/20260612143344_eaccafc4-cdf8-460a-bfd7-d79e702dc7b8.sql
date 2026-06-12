
-- 1) payment_cta_clicks
CREATE TABLE public.payment_cta_clicks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cta_type text NOT NULL, -- 'deposit_30','full_100','plan_explained','payment_link','order_now','contact_agent'
  channel text NOT NULL DEFAULT 'chatbot', -- 'chatbot','admin_portal','checkout','email'
  actor_role text NOT NULL DEFAULT 'customer', -- 'customer','admin','guest'
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  admin_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  order_id uuid,
  conversation_id uuid,
  product_id text,
  product_title text,
  product_url text,
  amount_usd numeric,
  session_id text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  user_agent text,
  ip_hash text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_payment_cta_clicks_created_at ON public.payment_cta_clicks(created_at DESC);
CREATE INDEX idx_payment_cta_clicks_user ON public.payment_cta_clicks(user_id);
CREATE INDEX idx_payment_cta_clicks_conv ON public.payment_cta_clicks(conversation_id);
CREATE INDEX idx_payment_cta_clicks_type ON public.payment_cta_clicks(cta_type);

GRANT INSERT ON public.payment_cta_clicks TO anon, authenticated;
GRANT SELECT ON public.payment_cta_clicks TO authenticated;
GRANT ALL ON public.payment_cta_clicks TO service_role;

ALTER TABLE public.payment_cta_clicks ENABLE ROW LEVEL SECURITY;

-- Anyone (incl. guests) can log a click event
CREATE POLICY "anyone can insert cta click" ON public.payment_cta_clicks
  FOR INSERT TO anon, authenticated WITH CHECK (true);

-- Users can read their own clicks
CREATE POLICY "users read their cta clicks" ON public.payment_cta_clicks
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

-- Admins read everything
CREATE POLICY "admins read all cta clicks" ON public.payment_cta_clicks
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- 2) chatbot_payment_escalations
CREATE TABLE public.chatbot_payment_escalations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid,
  message_id uuid,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  customer_message text NOT NULL,
  bot_answer text,
  reason text NOT NULL, -- 'NO_ACTIONABLE_PAYMENT_STEP','UNCLEAR_PAYMENT_PLAN','DISCOUNT_OBJECTION',etc.
  product_id text,
  product_title text,
  status text NOT NULL DEFAULT 'open', -- open | in_progress | resolved | dismissed
  resolved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  resolved_at timestamptz,
  resolution_note text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_pay_esc_status ON public.chatbot_payment_escalations(status, created_at DESC);
CREATE INDEX idx_pay_esc_conv ON public.chatbot_payment_escalations(conversation_id);

GRANT INSERT ON public.chatbot_payment_escalations TO anon, authenticated;
GRANT SELECT, UPDATE ON public.chatbot_payment_escalations TO authenticated;
GRANT ALL ON public.chatbot_payment_escalations TO service_role;

ALTER TABLE public.chatbot_payment_escalations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anyone can insert payment escalation" ON public.chatbot_payment_escalations
  FOR INSERT TO anon, authenticated WITH CHECK (true);

CREATE POLICY "admins read payment escalations" ON public.chatbot_payment_escalations
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "admins update payment escalations" ON public.chatbot_payment_escalations
  FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER trg_pay_esc_updated
  BEFORE UPDATE ON public.chatbot_payment_escalations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 3) trigger: notify admins when new escalation row is added
CREATE OR REPLACE FUNCTION public.notify_admins_payment_escalation()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.admin_notifications (type, title, message, severity, metadata)
  VALUES (
    'payment_escalation',
    'Sophie could not close a payment',
    LEFT(COALESCE(NEW.customer_message, ''), 200),
    'high',
    jsonb_build_object(
      'escalation_id', NEW.id,
      'conversation_id', NEW.conversation_id,
      'reason', NEW.reason,
      'product_title', NEW.product_title
    )
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Don't block escalation insert if notifications table shape differs
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_notify_payment_escalation
  AFTER INSERT ON public.chatbot_payment_escalations
  FOR EACH ROW EXECUTE FUNCTION public.notify_admins_payment_escalation();
