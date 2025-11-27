-- Create settings table for fees and markup if not exists (already exists, just adding new columns)
ALTER TABLE public.settings 
  ADD COLUMN IF NOT EXISTS global_markup_percent NUMERIC DEFAULT 0.15,
  ADD COLUMN IF NOT EXISTS category_markups JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS extra_fees JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS discount_codes JSONB DEFAULT '[]'::jsonb;

-- Add payment verification tracking to orders
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS payment_verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS payment_verified_by UUID REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS payment_verification_method TEXT, -- 'AUTOMATIC', 'MANUAL_OVERRIDE'
  ADD COLUMN IF NOT EXISTS payment_notes TEXT;

COMMENT ON COLUMN public.settings.global_markup_percent IS 'Default markup percentage applied to all products';
COMMENT ON COLUMN public.settings.category_markups IS 'Category-specific markup percentages: {"electronics": 0.20, "clothing": 0.25}';
COMMENT ON COLUMN public.settings.extra_fees IS 'Additional fees: [{"name": "Insurance", "amount": 5.00, "type": "fixed"}]';
COMMENT ON COLUMN public.settings.discount_codes IS 'Discount codes: [{"code": "SAVE10", "percent": 0.10, "active": true}]';