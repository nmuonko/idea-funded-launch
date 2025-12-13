-- Add quoted_by and quoted_at columns to quote_requests for audit trail
ALTER TABLE quote_requests 
ADD COLUMN IF NOT EXISTS quoted_by uuid REFERENCES auth.users(id),
ADD COLUMN IF NOT EXISTS quoted_at timestamp with time zone;

-- Add index for faster lookups on vehicle items
CREATE INDEX IF NOT EXISTS idx_order_items_is_vehicle ON order_items(is_vehicle) WHERE is_vehicle = true;
CREATE INDEX IF NOT EXISTS idx_order_items_vehicle_quote_applied ON order_items(vehicle_quote_applied) WHERE is_vehicle = true;

-- Add index for quote requests lookup by order_item_id
CREATE INDEX IF NOT EXISTS idx_quote_requests_order_item_id ON quote_requests(order_item_id);

-- Ensure unique constraint on order_item_id to prevent duplicate quotes
CREATE UNIQUE INDEX IF NOT EXISTS idx_quote_requests_order_item_unique ON quote_requests(order_item_id);