-- Create maisha_payments table for tracking MaishaPay transactions
CREATE TABLE IF NOT EXISTS public.maisha_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  maisha_reference TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending',
  amount_usd NUMERIC,
  amount_cdf NUMERIC,
  currency TEXT DEFAULT 'USD',
  raw_request JSONB,
  raw_response JSONB,
  paid_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.maisha_payments ENABLE ROW LEVEL SECURITY;

-- Admins can view all payments
CREATE POLICY "Admins can view all payments"
ON public.maisha_payments
FOR SELECT
USING (has_role(auth.uid(), 'admin'::app_role));

-- Admins can insert payments
CREATE POLICY "Admins can insert payments"
ON public.maisha_payments
FOR INSERT
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- Admins can update payments
CREATE POLICY "Admins can update payments"
ON public.maisha_payments
FOR UPDATE
USING (has_role(auth.uid(), 'admin'::app_role));

-- Users can view their own order payments
CREATE POLICY "Users can view their own order payments"
ON public.maisha_payments
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.orders
    WHERE orders.id = maisha_payments.order_id
    AND orders.user_id = auth.uid()
  )
);

-- Add index for faster lookups
CREATE INDEX IF NOT EXISTS idx_maisha_payments_order_id ON public.maisha_payments(order_id);
CREATE INDEX IF NOT EXISTS idx_maisha_payments_maisha_reference ON public.maisha_payments(maisha_reference);
CREATE INDEX IF NOT EXISTS idx_maisha_payments_status ON public.maisha_payments(status);

-- Add trigger for updated_at
CREATE TRIGGER update_maisha_payments_updated_at
BEFORE UPDATE ON public.maisha_payments
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at();