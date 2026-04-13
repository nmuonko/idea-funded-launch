
-- Add pricing protection columns to settings table
ALTER TABLE public.settings
  ADD COLUMN IF NOT EXISTS min_profit_usd numeric DEFAULT 3.00,
  ADD COLUMN IF NOT EXISTS min_profit_percent numeric DEFAULT 8,
  ADD COLUMN IF NOT EXISTS operational_buffer_percent numeric DEFAULT 3,
  ADD COLUMN IF NOT EXISTS exchange_rate_buffer_percent numeric DEFAULT 5,
  ADD COLUMN IF NOT EXISTS risk_buffer_percent numeric DEFAULT 2,
  ADD COLUMN IF NOT EXISTS payment_fee_percent numeric DEFAULT 4,
  ADD COLUMN IF NOT EXISTS payment_fee_fixed_usd numeric DEFAULT 0.50,
  ADD COLUMN IF NOT EXISTS price_rounding_mode text DEFAULT 'up_nearest_dollar',
  ADD COLUMN IF NOT EXISTS emergency_protection_percent numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS low_margin_block_threshold_usd numeric DEFAULT 1.00,
  ADD COLUMN IF NOT EXISTS stale_price_max_hours integer DEFAULT 48,
  ADD COLUMN IF NOT EXISTS category_protection_overrides jsonb DEFAULT '{}'::jsonb;

-- Create pricing audit log table
CREATE TABLE IF NOT EXISTS public.pricing_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid REFERENCES public.orders(id) ON DELETE SET NULL,
  order_item_id uuid,
  product_url text,
  source_cost_usd numeric NOT NULL,
  shipping_used_usd numeric NOT NULL DEFAULT 0,
  markup_applied_usd numeric NOT NULL DEFAULT 0,
  payment_fee_usd numeric NOT NULL DEFAULT 0,
  operational_buffer_usd numeric NOT NULL DEFAULT 0,
  exchange_buffer_usd numeric NOT NULL DEFAULT 0,
  risk_buffer_usd numeric NOT NULL DEFAULT 0,
  emergency_buffer_usd numeric NOT NULL DEFAULT 0,
  min_profit_floor_applied boolean NOT NULL DEFAULT false,
  raw_total_usd numeric NOT NULL DEFAULT 0,
  protected_total_usd numeric NOT NULL DEFAULT 0,
  profit_usd numeric NOT NULL DEFAULT 0,
  margin_percent numeric NOT NULL DEFAULT 0,
  protection_status text NOT NULL DEFAULT 'protected',
  pricing_confidence text DEFAULT 'high',
  reason_codes text[] DEFAULT '{}',
  settings_snapshot jsonb DEFAULT '{}',
  category_key text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.pricing_audit_log ENABLE ROW LEVEL SECURITY;

-- Only service_role can insert (backend only)
CREATE POLICY "Service role can insert audit logs"
  ON public.pricing_audit_log FOR INSERT
  TO service_role
  WITH CHECK (true);

-- Admins can view audit logs
CREATE POLICY "Admins can view pricing audit logs"
  ON public.pricing_audit_log FOR SELECT
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.admin_users WHERE admin_users.email = auth.email())
  );

-- Index for quick lookups
CREATE INDEX IF NOT EXISTS idx_pricing_audit_order ON public.pricing_audit_log(order_id);
CREATE INDEX IF NOT EXISTS idx_pricing_audit_status ON public.pricing_audit_log(protection_status);
CREATE INDEX IF NOT EXISTS idx_pricing_audit_created ON public.pricing_audit_log(created_at DESC);
