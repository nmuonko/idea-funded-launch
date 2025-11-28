-- Extend settings table with markup configuration
ALTER TABLE public.settings
ADD COLUMN IF NOT EXISTS markup_percent numeric DEFAULT 15.0,
ADD COLUMN IF NOT EXISTS min_service_fee_usd numeric DEFAULT 5.0;

COMMENT ON COLUMN public.settings.markup_percent IS 'Markup percentage to add to base product price';
COMMENT ON COLUMN public.settings.min_service_fee_usd IS 'Minimum service fee in USD';

-- Extend order_items table with detailed pricing breakdown
ALTER TABLE public.order_items
ADD COLUMN IF NOT EXISTS base_price_usd numeric,
ADD COLUMN IF NOT EXISTS markup_fee_usd numeric,
ADD COLUMN IF NOT EXISTS shipping_fee_usd numeric,
ADD COLUMN IF NOT EXISTS total_price_usd numeric,
ADD COLUMN IF NOT EXISTS total_price_cdf numeric,
ADD COLUMN IF NOT EXISTS product_image_url text;

COMMENT ON COLUMN public.order_items.base_price_usd IS 'Original product price in USD';
COMMENT ON COLUMN public.order_items.markup_fee_usd IS 'Markup fee applied to this item';
COMMENT ON COLUMN public.order_items.shipping_fee_usd IS 'Shipping fee for this item';
COMMENT ON COLUMN public.order_items.total_price_usd IS 'Total price per unit including all fees (USD)';
COMMENT ON COLUMN public.order_items.total_price_cdf IS 'Total price per unit including all fees (CDF)';

-- Insert default settings if none exist
INSERT INTO public.settings (
  service_fee_percent,
  shipping_base_fee_usd,
  shipping_percent,
  exchange_rate_usd_to_cdf,
  markup_percent,
  min_service_fee_usd
)
SELECT 0.12, 10.0, 0.10, 2800.0, 15.0, 5.0
WHERE NOT EXISTS (SELECT 1 FROM public.settings LIMIT 1);