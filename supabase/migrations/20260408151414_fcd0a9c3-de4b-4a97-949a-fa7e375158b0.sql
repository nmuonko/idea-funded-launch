
-- Add new columns to shipping_item_types
ALTER TABLE public.shipping_item_types
  ADD COLUMN IF NOT EXISTS flat_shipping_usd numeric DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS shipping_buffer_percent numeric NOT NULL DEFAULT 25;

-- Add shipping_rate_per_kg to settings
ALTER TABLE public.settings
  ADD COLUMN IF NOT EXISTS shipping_rate_per_kg numeric NOT NULL DEFAULT 20;

-- Set flat shipping for phones/tablets categories
UPDATE public.shipping_item_types
SET flat_shipping_usd = 50
WHERE key IN ('small_electronics', 'laptop_tablet');

-- Set higher buffer for console/medium
UPDATE public.shipping_item_types
SET shipping_buffer_percent = 30
WHERE key = 'console_medium';

-- TV/large has manual quote, set buffer to 0
UPDATE public.shipping_item_types
SET shipping_buffer_percent = 0
WHERE key = 'tv_large_appliance';
