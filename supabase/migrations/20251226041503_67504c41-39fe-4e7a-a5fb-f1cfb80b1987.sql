-- Migration 5 (retry): Fix duplicates and add indexes/constraints

-- First, clean up duplicate checkout sessions keeping only the newest
-- Delete older initiated/pending sessions for users with duplicates
WITH ranked_sessions AS (
  SELECT id, user_id, status, created_at,
         ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY created_at DESC) as rn
  FROM public.checkout_sessions
  WHERE status IN ('initiated', 'pending')
),
sessions_to_delete AS (
  SELECT id FROM ranked_sessions WHERE rn > 1
)
UPDATE public.checkout_sessions 
SET status = 'expired'
WHERE id IN (SELECT id FROM sessions_to_delete);

-- Now add the unique index for single active checkout session per user
CREATE UNIQUE INDEX IF NOT EXISTS idx_checkout_sessions_single_active_per_user 
  ON public.checkout_sessions(user_id) 
  WHERE status IN ('initiated', 'pending');

-- Add other performance indexes that may not have been created
CREATE INDEX IF NOT EXISTS idx_orders_user_status ON public.orders(user_id, status);
CREATE INDEX IF NOT EXISTS idx_orders_created_desc ON public.orders(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_pending_payment ON public.orders(user_id, updated_at) 
  WHERE status = 'PENDING_PAYMENT'::order_status;

CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON public.order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_order_items_saved ON public.order_items(order_id) 
  WHERE is_saved_for_later = true;

CREATE INDEX IF NOT EXISTS idx_maisha_payments_order_id ON public.maisha_payments(order_id);
CREATE INDEX IF NOT EXISTS idx_maisha_payments_reference ON public.maisha_payments(maisha_reference);
CREATE INDEX IF NOT EXISTS idx_maisha_payments_pending ON public.maisha_payments(status, created_at) 
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_checkout_sessions_order ON public.checkout_sessions(order_id);
CREATE INDEX IF NOT EXISTS idx_checkout_sessions_user ON public.checkout_sessions(user_id, created_at DESC);