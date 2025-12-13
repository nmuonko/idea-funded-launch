-- AI Actions Queue for admin review
CREATE TABLE public.ai_action_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action_type TEXT NOT NULL, -- 'ticket_response', 'cart_recovery', 'escalation', 'recommendation'
  target_id UUID NOT NULL, -- ticket_id, order_id, etc.
  target_type TEXT NOT NULL, -- 'support_ticket', 'order', 'user'
  ai_decision JSONB NOT NULL,
  confidence_score NUMERIC(3,2),
  status TEXT DEFAULT 'pending_review', -- 'pending_review', 'approved', 'rejected', 'auto_executed'
  reviewed_by UUID,
  reviewed_at TIMESTAMPTZ,
  executed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE public.ai_action_queue ENABLE ROW LEVEL SECURITY;

-- RLS policies for ai_action_queue
CREATE POLICY "Admins can view all AI actions"
  ON public.ai_action_queue FOR SELECT
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can update AI actions"
  ON public.ai_action_queue FOR UPDATE
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Service role can insert AI actions"
  ON public.ai_action_queue FOR INSERT
  WITH CHECK (true);

-- Ticket AI enrichment columns
ALTER TABLE public.support_tickets ADD COLUMN IF NOT EXISTS ai_sentiment TEXT;
ALTER TABLE public.support_tickets ADD COLUMN IF NOT EXISTS ai_topic TEXT;
ALTER TABLE public.support_tickets ADD COLUMN IF NOT EXISTS ai_urgency_score INTEGER;
ALTER TABLE public.support_tickets ADD COLUMN IF NOT EXISTS ai_suggested_response TEXT;
ALTER TABLE public.support_tickets ADD COLUMN IF NOT EXISTS ai_analyzed_at TIMESTAMPTZ;

-- Recommendations cache
CREATE TABLE public.product_recommendations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  recommendations JSONB NOT NULL, -- [{product_url, title, reason, score}]
  context TEXT NOT NULL, -- 'homepage', 'cart', 'post_purchase'
  expires_at TIMESTAMPTZ DEFAULT NOW() + INTERVAL '24 hours',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE public.product_recommendations ENABLE ROW LEVEL SECURITY;

-- RLS policies for product_recommendations
CREATE POLICY "Users can view their own recommendations"
  ON public.product_recommendations FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Service role can manage recommendations"
  ON public.product_recommendations FOR ALL
  USING (true);

-- Recommendation engagement tracking
CREATE TABLE public.recommendation_clicks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  recommendation_id UUID REFERENCES public.product_recommendations(id),
  product_url TEXT NOT NULL,
  clicked_at TIMESTAMPTZ DEFAULT NOW(),
  converted BOOLEAN DEFAULT FALSE
);

-- Enable RLS
ALTER TABLE public.recommendation_clicks ENABLE ROW LEVEL SECURITY;

-- RLS policies for recommendation_clicks
CREATE POLICY "Users can insert their own clicks"
  ON public.recommendation_clicks FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Service role can manage clicks"
  ON public.recommendation_clicks FOR ALL
  USING (true);

-- Cart recovery predictions table
CREATE TABLE public.cart_recovery_predictions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID REFERENCES public.orders(id),
  user_id UUID NOT NULL,
  optimal_send_time TIMESTAMPTZ,
  suggested_discount_percent INTEGER,
  personalized_subject TEXT,
  personalized_body TEXT,
  conversion_probability NUMERIC(3,2),
  ai_reasoning TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  sent_at TIMESTAMPTZ,
  converted_at TIMESTAMPTZ
);

-- Enable RLS
ALTER TABLE public.cart_recovery_predictions ENABLE ROW LEVEL SECURITY;

-- RLS policies for cart_recovery_predictions
CREATE POLICY "Admins can view all predictions"
  ON public.cart_recovery_predictions FOR SELECT
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Service role can manage predictions"
  ON public.cart_recovery_predictions FOR ALL
  USING (true);