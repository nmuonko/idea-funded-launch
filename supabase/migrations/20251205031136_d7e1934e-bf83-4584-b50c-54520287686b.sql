-- Create quote_requests table for vehicles and other items requiring manual quotes
CREATE TABLE IF NOT EXISTS public.quote_requests (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  order_item_id UUID NOT NULL REFERENCES public.order_items(id) ON DELETE CASCADE,
  title TEXT,
  product_url TEXT,
  store_name TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING',
  quoted_shipping_usd NUMERIC,
  quoted_total_usd NUMERIC,
  admin_notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Add index for user lookups
CREATE INDEX idx_quote_requests_user_id ON public.quote_requests(user_id);
CREATE INDEX idx_quote_requests_order_item_id ON public.quote_requests(order_item_id);
CREATE INDEX idx_quote_requests_status ON public.quote_requests(status);

-- Enable RLS
ALTER TABLE public.quote_requests ENABLE ROW LEVEL SECURITY;

-- Users can view their own quote requests
CREATE POLICY "Users can view their own quote requests"
ON public.quote_requests FOR SELECT
USING (auth.uid() = user_id);

-- Admins can view all quote requests
CREATE POLICY "Admins can view all quote requests"
ON public.quote_requests FOR SELECT
USING (has_role(auth.uid(), 'admin'::app_role));

-- Service role can insert quote requests
CREATE POLICY "Service role can insert quote requests"
ON public.quote_requests FOR INSERT
WITH CHECK (true);

-- Admins can update quote requests
CREATE POLICY "Admins can update quote requests"
ON public.quote_requests FOR UPDATE
USING (has_role(auth.uid(), 'admin'::app_role));

-- Add trigger for updated_at
CREATE TRIGGER update_quote_requests_updated_at
BEFORE UPDATE ON public.quote_requests
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at();

-- Add is_vehicle flag to order_items for easy filtering
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS is_vehicle BOOLEAN DEFAULT false;