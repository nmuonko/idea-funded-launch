-- Table to store mobile device push notification tokens
CREATE TABLE IF NOT EXISTS public.device_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  device_token TEXT NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('ios', 'android')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  last_used_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id, device_token)
);

-- Enable RLS
ALTER TABLE public.device_tokens ENABLE ROW LEVEL SECURITY;

-- Users can manage their own device tokens
CREATE POLICY "Users can insert their own device tokens"
  ON public.device_tokens
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can view their own device tokens"
  ON public.device_tokens
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own device tokens"
  ON public.device_tokens
  FOR DELETE
  USING (auth.uid() = user_id);

-- Admins can view all tokens for debugging
CREATE POLICY "Admins can view all device tokens"
  ON public.device_tokens
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = auth.uid() AND role = 'admin'
    )
  );

-- Table to track A/B test variants for abandoned cart emails
CREATE TABLE IF NOT EXISTS public.cart_recovery_ab_tests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  variant_name TEXT NOT NULL, -- '24h', '48h', '72h'
  sent_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  email_opened BOOLEAN DEFAULT FALSE,
  email_opened_at TIMESTAMP WITH TIME ZONE,
  converted BOOLEAN DEFAULT FALSE,
  converted_at TIMESTAMP WITH TIME ZONE,
  cart_value_usd NUMERIC,
  segment TEXT, -- 'high_value', 'standard', etc.
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE public.cart_recovery_ab_tests ENABLE ROW LEVEL SECURITY;

-- Admins can view all A/B test data
CREATE POLICY "Admins can view all A/B test data"
  ON public.cart_recovery_ab_tests
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = auth.uid() AND role = 'admin'
    )
  );

-- Admins can insert A/B test data
CREATE POLICY "Admins can insert A/B test data"
  ON public.cart_recovery_ab_tests
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = auth.uid() AND role = 'admin'
    )
  );

-- Admins can update A/B test data
CREATE POLICY "Admins can update A/B test data"
  ON public.cart_recovery_ab_tests
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = auth.uid() AND role = 'admin'
    )
  );

-- Create index for faster queries
CREATE INDEX idx_device_tokens_user_id ON public.device_tokens(user_id);
CREATE INDEX idx_device_tokens_platform ON public.device_tokens(platform);
CREATE INDEX idx_ab_tests_order_id ON public.cart_recovery_ab_tests(order_id);
CREATE INDEX idx_ab_tests_variant ON public.cart_recovery_ab_tests(variant_name);
CREATE INDEX idx_ab_tests_converted ON public.cart_recovery_ab_tests(converted);

-- Trigger to update updated_at
CREATE TRIGGER update_device_tokens_updated_at
  BEFORE UPDATE ON public.device_tokens
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at();
