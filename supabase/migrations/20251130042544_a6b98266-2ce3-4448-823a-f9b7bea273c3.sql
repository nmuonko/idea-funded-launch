-- Add MaishaPay callback tracking columns to orders table
ALTER TABLE orders ADD COLUMN IF NOT EXISTS operator_ref_id TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS maisha_status_code TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS maisha_description TEXT;

-- Create index for faster lookup by transaction ID
CREATE INDEX IF NOT EXISTS idx_orders_maisha_transaction_id ON orders(maisha_transaction_id);