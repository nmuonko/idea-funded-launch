-- Performance indexes for AfriShop backend optimization
-- These indexes speed up the most frequently used queries

-- Index for orders by user_id and status (cart fetch, order history)
CREATE INDEX IF NOT EXISTS idx_orders_user_status ON orders(user_id, status);

-- Index for order_items by order_id (fetching items for an order)
CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id);

-- Index for quote_requests by user_id and status (quote management)
CREATE INDEX IF NOT EXISTS idx_quote_requests_user_status ON quote_requests(user_id, status);

-- Index for quote_requests by order_item_id (joining quotes to items)
CREATE INDEX IF NOT EXISTS idx_quote_requests_order_item ON quote_requests(order_item_id);

-- Index for maisha_payments by order_id (payment lookups)
CREATE INDEX IF NOT EXISTS idx_maisha_payments_order_id ON maisha_payments(order_id);

-- Index for profiles by user_id (profile lookups - most common query)
CREATE INDEX IF NOT EXISTS idx_profiles_user_id ON profiles(user_id);

-- Composite index for order_items saved items lookup
CREATE INDEX IF NOT EXISTS idx_order_items_order_saved ON order_items(order_id, is_saved_for_later);