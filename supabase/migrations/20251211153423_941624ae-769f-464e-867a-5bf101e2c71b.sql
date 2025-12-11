-- Add vehicle_quote_applied to order_items to track when a quote has been applied
ALTER TABLE public.order_items 
ADD COLUMN IF NOT EXISTS vehicle_quote_applied boolean DEFAULT false;

-- Add locale and email to quote_requests for notification purposes
ALTER TABLE public.quote_requests 
ADD COLUMN IF NOT EXISTS locale text DEFAULT 'fr';

ALTER TABLE public.quote_requests 
ADD COLUMN IF NOT EXISTS customer_email text;

-- Create index for faster quote lookups by order_item_id
CREATE INDEX IF NOT EXISTS idx_quote_requests_order_item_id ON public.quote_requests(order_item_id);

-- Create index for faster quote lookups by status
CREATE INDEX IF NOT EXISTS idx_quote_requests_status ON public.quote_requests(status);