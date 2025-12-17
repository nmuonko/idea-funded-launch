-- Add vehicle payment audit columns to orders table
ALTER TABLE orders ADD COLUMN IF NOT EXISTS contains_vehicle boolean DEFAULT false;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS normalized_currency text DEFAULT null;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS normalized_amount numeric DEFAULT null;

-- Add index for vehicle orders queries
CREATE INDEX IF NOT EXISTS idx_orders_contains_vehicle ON orders(contains_vehicle) WHERE contains_vehicle = true;