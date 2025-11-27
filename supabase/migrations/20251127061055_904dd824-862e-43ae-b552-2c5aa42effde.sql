-- Add order action log table for timeline
CREATE TABLE IF NOT EXISTS public.order_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  actor_id UUID NOT NULL REFERENCES auth.users(id),
  action_type TEXT NOT NULL, -- 'APPROVED', 'REJECTED', 'INFO_REQUESTED', 'PAYMENT_VERIFIED', 'SHIPPED', 'DELIVERED', 'NOTE_ADDED'
  action_message TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Add indexes for performance
CREATE INDEX idx_order_actions_order_id ON public.order_actions(order_id);
CREATE INDEX idx_order_actions_created_at ON public.order_actions(created_at DESC);

-- Enable RLS
ALTER TABLE public.order_actions ENABLE ROW LEVEL SECURITY;

-- Admins can view all order actions
CREATE POLICY "Admins can view all order actions"
  ON public.order_actions
  FOR SELECT
  USING (has_role(auth.uid(), 'admin'::app_role));

-- Admins can insert order actions
CREATE POLICY "Admins can insert order actions"
  ON public.order_actions
  FOR INSERT
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- Add admin_role column to user_roles for granular permissions
ALTER TABLE public.user_roles 
  ADD COLUMN IF NOT EXISTS admin_role TEXT DEFAULT 'super_admin';

-- Add comment for admin roles
COMMENT ON COLUMN public.user_roles.admin_role IS 'Admin role types: super_admin, finance, operations, support';

-- Add requested_info field to orders for tracking info requests
ALTER TABLE public.orders 
  ADD COLUMN IF NOT EXISTS info_requested BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS admin_notes TEXT;

-- Add tracking fields for workflow
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS rejected_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS rejected_by UUID REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS rejection_reason TEXT;