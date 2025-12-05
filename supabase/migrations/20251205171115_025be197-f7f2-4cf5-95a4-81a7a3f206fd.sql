-- Add actual shipping cost tracking to orders table
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS actual_shipping_cost_usd numeric;

-- Add comment for documentation
COMMENT ON COLUMN public.orders.actual_shipping_cost_usd IS 'Actual shipping cost incurred by AfriShop for this order';