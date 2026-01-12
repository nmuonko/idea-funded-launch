-- ============================================
-- Payment Settings Table for Admin-Configurable Limits
-- ============================================

-- Create the payment_settings table (single-row config)
CREATE TABLE IF NOT EXISTS public.payment_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mobile_money_max_usd numeric NOT NULL DEFAULT 250,
  mobile_money_max_cdf numeric NOT NULL DEFAULT 1500000,
  large_order_currency text NOT NULL DEFAULT 'USD',
  stripe_enabled boolean NOT NULL DEFAULT true,
  bank_transfer_enabled boolean NOT NULL DEFAULT true,
  pawapay_enabled boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.payment_settings ENABLE ROW LEVEL SECURITY;

-- RLS Policies

-- Authenticated users can read payment settings
CREATE POLICY "Authenticated users can read payment settings"
ON public.payment_settings
FOR SELECT
USING (auth.uid() IS NOT NULL);

-- Admins can update payment settings
CREATE POLICY "Admins can update payment settings"
ON public.payment_settings
FOR UPDATE
USING (has_role(auth.uid(), 'admin'::app_role));

-- Admins can insert payment settings (for initial seed)
CREATE POLICY "Admins can insert payment settings"
ON public.payment_settings
FOR INSERT
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- Service role can manage all (for edge functions)
CREATE POLICY "Service role can manage payment settings"
ON public.payment_settings
FOR ALL
USING (true)
WITH CHECK (true);

-- Seed one row if none exists
INSERT INTO public.payment_settings (
  mobile_money_max_usd,
  mobile_money_max_cdf,
  large_order_currency,
  stripe_enabled,
  bank_transfer_enabled,
  pawapay_enabled
)
SELECT 250, 1500000, 'USD', true, true, true
WHERE NOT EXISTS (SELECT 1 FROM public.payment_settings);

-- Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION public.update_payment_settings_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- Create trigger for automatic timestamp updates
CREATE TRIGGER update_payment_settings_updated_at
BEFORE UPDATE ON public.payment_settings
FOR EACH ROW
EXECUTE FUNCTION public.update_payment_settings_updated_at();