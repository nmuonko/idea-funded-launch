-- Database Optimizations for 10K+ Users (indexes only)

-- Add covering index for cart queries
CREATE INDEX IF NOT EXISTS idx_order_items_cart_lookup 
ON order_items(order_id, is_saved_for_later) 
INCLUDE (title, quantity, total_price_usd, product_image_url);

-- Add index for payment lookups
CREATE INDEX IF NOT EXISTS idx_payments_order_lookup 
ON payments(order_id, created_at DESC);

-- Add index for active checkout sessions
CREATE INDEX IF NOT EXISTS idx_checkout_sessions_user_active 
ON checkout_sessions(user_id, created_at DESC);

-- Add index for pending transfer proofs
CREATE INDEX IF NOT EXISTS idx_manual_proofs_pending 
ON manual_transfer_proofs(created_at DESC) 
WHERE status = 'pending';