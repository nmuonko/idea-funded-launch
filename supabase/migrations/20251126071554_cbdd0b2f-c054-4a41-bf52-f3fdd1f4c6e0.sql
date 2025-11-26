-- AfriShop Database Schema Migration
-- This replaces the AfriFund schema with AfriShop schema

-- Drop old tables (keep profiles and user_roles)
DROP TABLE IF EXISTS winners CASCADE;
DROP TABLE IF EXISTS notification_logs CASCADE;
DROP TABLE IF EXISTS payments CASCADE;
DROP TABLE IF EXISTS user_submissions CASCADE;
DROP TABLE IF EXISTS sessions CASCADE;
DROP TABLE IF EXISTS contact_messages CASCADE;
DROP TABLE IF EXISTS chat_messages CASCADE;
DROP TABLE IF EXISTS admin_ai_logs CASCADE;
DROP TABLE IF EXISTS site_content CASCADE;
DROP TABLE IF EXISTS theme_settings CASCADE;
DROP TABLE IF EXISTS feature_flags CASCADE;

-- Drop old enums
DROP TYPE IF EXISTS payment_method CASCADE;
DROP TYPE IF EXISTS payment_status CASCADE;
DROP TYPE IF EXISTS session_status CASCADE;
DROP TYPE IF EXISTS submission_status CASCADE;
DROP TYPE IF EXISTS notification_channel CASCADE;
DROP TYPE IF EXISTS notification_type CASCADE;

-- Update profiles table to match AfriShop needs
ALTER TABLE profiles DROP COLUMN IF EXISTS avatar_url;
ALTER TABLE profiles DROP COLUMN IF EXISTS display_name;
ALTER TABLE profiles DROP COLUMN IF EXISTS date_of_birth;
ALTER TABLE profiles DROP COLUMN IF EXISTS city;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS name TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS phone TEXT;

-- Create order status enum
CREATE TYPE order_status AS ENUM (
  'DRAFT',
  'PENDING_PAYMENT',
  'PAID',
  'PROCESSING',
  'SHIPPED',
  'READY_FOR_PICKUP',
  'COMPLETED',
  'CANCELLED'
);

-- Create store enum
CREATE TYPE store_type AS ENUM (
  'AMAZON',
  'EBAY',
  'WALMART',
  'CARVANA',
  'CARGURUS',
  'BESTBUY',
  'OTHER'
);

-- Create shipping city enum
CREATE TYPE shipping_city AS ENUM (
  'KINSHASA',
  'LUBUMBASHI',
  'OTHER'
);

-- Create orders table
CREATE TABLE orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status order_status NOT NULL DEFAULT 'DRAFT',
  shipping_city shipping_city,
  item_total_usd DECIMAL(10,2) DEFAULT 0,
  service_fee_usd DECIMAL(10,2) DEFAULT 0,
  shipping_fee_usd DECIMAL(10,2) DEFAULT 0,
  total_usd DECIMAL(10,2) DEFAULT 0,
  total_cdf DECIMAL(12,2) DEFAULT 0,
  exchange_rate_used DECIMAL(10,4),
  maisha_transaction_id TEXT,
  maisha_payment_status TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create order_items table
CREATE TABLE order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  store store_type NOT NULL,
  product_url TEXT NOT NULL,
  title TEXT,
  notes TEXT,
  unit_price_usd DECIMAL(10,2),
  quantity INTEGER NOT NULL DEFAULT 1,
  subtotal_usd DECIMAL(10,2),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create settings table (singleton)
CREATE TABLE settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_fee_percent DECIMAL(5,4) NOT NULL DEFAULT 0.12,
  shipping_base_fee_usd DECIMAL(10,2) NOT NULL DEFAULT 10.00,
  shipping_percent DECIMAL(5,4) NOT NULL DEFAULT 0.10,
  exchange_rate_usd_to_cdf DECIMAL(10,4) NOT NULL DEFAULT 2800.0000,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create indexes
CREATE INDEX idx_orders_user_id ON orders(user_id);
CREATE INDEX idx_orders_status ON orders(status);
CREATE INDEX idx_orders_created_at ON orders(created_at DESC);
CREATE INDEX idx_order_items_order_id ON order_items(order_id);

-- Enable RLS
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE settings ENABLE ROW LEVEL SECURITY;

-- RLS Policies for orders
CREATE POLICY "Users can view their own orders"
  ON orders FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own orders"
  ON orders FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own draft orders"
  ON orders FOR UPDATE
  USING (auth.uid() = user_id AND status = 'DRAFT');

CREATE POLICY "Admins can view all orders"
  ON orders FOR SELECT
  USING (has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can update all orders"
  ON orders FOR UPDATE
  USING (has_role(auth.uid(), 'admin'));

-- RLS Policies for order_items
CREATE POLICY "Users can view their own order items"
  ON order_items FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM orders 
    WHERE orders.id = order_items.order_id 
    AND orders.user_id = auth.uid()
  ));

CREATE POLICY "Users can insert items to their draft orders"
  ON order_items FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM orders 
    WHERE orders.id = order_items.order_id 
    AND orders.user_id = auth.uid()
    AND orders.status = 'DRAFT'
  ));

CREATE POLICY "Users can update items in their draft orders"
  ON order_items FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM orders 
    WHERE orders.id = order_items.order_id 
    AND orders.user_id = auth.uid()
    AND orders.status = 'DRAFT'
  ));

CREATE POLICY "Users can delete items from their draft orders"
  ON order_items FOR DELETE
  USING (EXISTS (
    SELECT 1 FROM orders 
    WHERE orders.id = order_items.order_id 
    AND orders.user_id = auth.uid()
    AND orders.status = 'DRAFT'
  ));

CREATE POLICY "Admins can manage all order items"
  ON order_items FOR ALL
  USING (has_role(auth.uid(), 'admin'));

-- RLS Policies for settings
CREATE POLICY "Anyone authenticated can view settings"
  ON settings FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Only admins can update settings"
  ON settings FOR UPDATE
  USING (has_role(auth.uid(), 'admin'));

CREATE POLICY "Only admins can insert settings"
  ON settings FOR INSERT
  WITH CHECK (has_role(auth.uid(), 'admin'));

-- Create trigger to update updated_at
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER orders_updated_at
  BEFORE UPDATE ON orders
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER order_items_updated_at
  BEFORE UPDATE ON order_items
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER settings_updated_at
  BEFORE UPDATE ON settings
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

-- Insert default settings row
INSERT INTO settings (
  service_fee_percent,
  shipping_base_fee_usd,
  shipping_percent,
  exchange_rate_usd_to_cdf
) VALUES (
  0.12,
  10.00,
  0.10,
  2800.0000
);