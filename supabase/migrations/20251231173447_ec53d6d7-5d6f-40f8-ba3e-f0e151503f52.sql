-- Add missing indexes for performance optimization

-- profiles: Currently at 0.91% index usage
CREATE INDEX IF NOT EXISTS idx_profiles_user_id ON public.profiles(user_id);

-- maisha_payments: Improve lookup performance
CREATE INDEX IF NOT EXISTS idx_maisha_payments_order_id ON public.maisha_payments(order_id);
CREATE INDEX IF NOT EXISTS idx_maisha_payments_status ON public.maisha_payments(status);

-- orders: Composite index for common user+status queries
CREATE INDEX IF NOT EXISTS idx_orders_user_status_created ON public.orders(user_id, status, created_at DESC);

-- order_items: Improve saved for later queries
CREATE INDEX IF NOT EXISTS idx_order_items_saved_for_later ON public.order_items(is_saved_for_later) WHERE is_saved_for_later = true;

-- checkout_sessions: Improve session lookups
CREATE INDEX IF NOT EXISTS idx_checkout_sessions_user_id ON public.checkout_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_checkout_sessions_order_id ON public.checkout_sessions(order_id);

-- payment_attempts: Improve lookup by order_id
CREATE INDEX IF NOT EXISTS idx_payment_attempts_order_id ON public.payment_attempts(order_id);
CREATE INDEX IF NOT EXISTS idx_payment_attempts_user_id ON public.payment_attempts(user_id);