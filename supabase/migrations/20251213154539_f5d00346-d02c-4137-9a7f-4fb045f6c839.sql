-- Performance Indexes for database optimization
-- Index for profiles user_id lookups
CREATE INDEX IF NOT EXISTS idx_profiles_user_id ON public.profiles(user_id);

-- Composite index for orders by user and status (common query pattern)
CREATE INDEX IF NOT EXISTS idx_orders_user_status ON public.orders(user_id, status);

-- Index for orders by status and created_at (admin dashboard queries)
CREATE INDEX IF NOT EXISTS idx_orders_status_created ON public.orders(status, created_at DESC);

-- Index for maisha_payments order lookups
CREATE INDEX IF NOT EXISTS idx_maisha_payments_order_id ON public.maisha_payments(order_id);

-- Index for maisha_payments by status
CREATE INDEX IF NOT EXISTS idx_maisha_payments_status ON public.maisha_payments(status);

-- Index for order_items order lookups
CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON public.order_items(order_id);

-- Index for quote_requests status lookups
CREATE INDEX IF NOT EXISTS idx_quote_requests_status ON public.quote_requests(status);