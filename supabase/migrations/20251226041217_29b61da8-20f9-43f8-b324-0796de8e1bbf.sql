-- Migration 3: Create system_audit_log table with compact payload design

-- Create system_audit_log table
CREATE TABLE IF NOT EXISTS public.system_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trace_id text NOT NULL,
  event_type text NOT NULL,
  user_id uuid,
  order_id uuid,
  payment_attempt_id uuid,
  payload jsonb DEFAULT '{}'::jsonb,
  error_message text,
  duration_ms integer,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Add comment
COMMENT ON TABLE public.system_audit_log IS 'Compact audit log for system events - payments, reconciliation, etc.';

-- Create indexes for system_audit_log
CREATE INDEX IF NOT EXISTS idx_audit_log_trace_id ON public.system_audit_log(trace_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_event_type_created ON public.system_audit_log(event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_user_id ON public.system_audit_log(user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_audit_log_order_id ON public.system_audit_log(order_id) WHERE order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_audit_log_created ON public.system_audit_log(created_at DESC);

-- Enable RLS
ALTER TABLE public.system_audit_log ENABLE ROW LEVEL SECURITY;

-- RLS Policies for system_audit_log
-- Only admins can view audit logs
CREATE POLICY "Admins can view audit logs"
  ON public.system_audit_log
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

-- No INSERT/UPDATE/DELETE policies - service role only inserts