-- Create shipping_item_types table
CREATE TABLE public.shipping_item_types (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  key TEXT UNIQUE NOT NULL,
  label TEXT NOT NULL,
  description TEXT,
  est_weight_kg NUMERIC NOT NULL,
  requires_manual_quote BOOLEAN NOT NULL DEFAULT false,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.shipping_item_types ENABLE ROW LEVEL SECURITY;

-- Public can read active types
CREATE POLICY "Anyone can view active shipping types"
ON public.shipping_item_types
FOR SELECT
USING (active = true);

-- Admins can manage all types
CREATE POLICY "Admins can manage shipping types"
ON public.shipping_item_types
FOR ALL
USING (has_role(auth.uid(), 'admin'::app_role));

-- Update trigger for updated_at
CREATE TRIGGER update_shipping_item_types_updated_at
BEFORE UPDATE ON public.shipping_item_types
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Seed default shipping types
INSERT INTO public.shipping_item_types (key, label, description, est_weight_kg, requires_manual_quote) VALUES
  ('small_electronics', 'Small electronics', 'Phones, earbuds, smartwatches, cameras', 0.7, false),
  ('clothes_shoes', 'Clothes / Shoes', 'Clothing, footwear, accessories', 0.5, false),
  ('laptop_tablet', 'Laptop / Tablet', 'MacBook, Chromebook, iPad, Surface', 2.5, false),
  ('console_medium', 'Console / Medium electronics', 'PlayStation, Xbox, printers, monitors', 6, false),
  ('tv_large_appliance', 'TV / Large appliance / Furniture', 'TVs, refrigerators, furniture, large items', 12, true);

-- Add shipping type columns to order_items
ALTER TABLE public.order_items
ADD COLUMN shipping_item_type_id UUID REFERENCES public.shipping_item_types(id),
ADD COLUMN est_weight_kg NUMERIC,
ADD COLUMN requires_manual_quote BOOLEAN DEFAULT false;

-- Add requires_manual_quote to orders table
ALTER TABLE public.orders
ADD COLUMN requires_manual_quote BOOLEAN DEFAULT false;