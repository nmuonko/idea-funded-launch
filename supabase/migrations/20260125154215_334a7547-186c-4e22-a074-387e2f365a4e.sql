-- Add refund tracking columns to orders table
ALTER TABLE orders
ADD COLUMN IF NOT EXISTS refund_issued_at timestamptz,
ADD COLUMN IF NOT EXISTS refund_issued_by uuid,
ADD COLUMN IF NOT EXISTS refund_reason text,
ADD COLUMN IF NOT EXISTS refund_amount_usd numeric;

-- Create index for refund queries
CREATE INDEX IF NOT EXISTS idx_orders_refund_issued ON orders(refund_issued_at) 
WHERE refund_issued_at IS NOT NULL;

-- Add reminder_count to order_items for tiered reminder tracking
ALTER TABLE order_items
ADD COLUMN IF NOT EXISTS reminder_count integer DEFAULT 0;