-- Add indexes for cart + payment lookup performance
-- These indexes improve the speed of common queries in mobile-get-cart, mobile-create-payment, etc.

-- Index for finding user's DRAFT orders quickly
CREATE INDEX IF NOT EXISTS idx_orders_user_status 
ON public.orders (user_id, status);

-- Index for order items by order_id (already may exist via FK)
CREATE INDEX IF NOT EXISTS idx_order_items_order_id 
ON public.order_items (order_id);

-- Index for maisha_payments by order_id for payment lookups
CREATE INDEX IF NOT EXISTS idx_maisha_payments_order_id 
ON public.maisha_payments (order_id);

-- Index for quote_requests by order_item_id
CREATE INDEX IF NOT EXISTS idx_quote_requests_order_item_id 
ON public.quote_requests (order_item_id);