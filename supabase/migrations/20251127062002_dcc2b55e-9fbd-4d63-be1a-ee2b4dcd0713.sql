-- Add shipping tracking to orders
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS tracking_number TEXT,
  ADD COLUMN IF NOT EXISTS carrier TEXT,
  ADD COLUMN IF NOT EXISTS shipped_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS estimated_delivery TIMESTAMPTZ;

-- Add indexes for shipping queries
CREATE INDEX IF NOT EXISTS idx_orders_status_shipped ON public.orders(status) WHERE status IN ('SHIPPED', 'READY_FOR_PICKUP');
CREATE INDEX IF NOT EXISTS idx_orders_shipped_at ON public.orders(shipped_at) WHERE shipped_at IS NOT NULL;

-- Add AI assistant interaction tracking
CREATE TABLE IF NOT EXISTS public.ai_assistant_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID REFERENCES public.orders(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id),
  action_type TEXT NOT NULL, -- 'SUMMARIZE', 'FRAUD_CHECK', 'DRAFT_EMAIL', 'GENERATE_LABEL'
  prompt TEXT,
  response TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.ai_assistant_logs ENABLE ROW LEVEL SECURITY;

-- Admins can view all AI logs
CREATE POLICY "Admins can view all AI logs"
  ON public.ai_assistant_logs
  FOR SELECT
  USING (has_role(auth.uid(), 'admin'::app_role));

-- Admins can insert AI logs
CREATE POLICY "Admins can insert AI logs"
  ON public.ai_assistant_logs
  FOR INSERT
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- Add index for AI logs
CREATE INDEX idx_ai_logs_order_id ON public.ai_assistant_logs(order_id);
CREATE INDEX idx_ai_logs_created_at ON public.ai_assistant_logs(created_at DESC);