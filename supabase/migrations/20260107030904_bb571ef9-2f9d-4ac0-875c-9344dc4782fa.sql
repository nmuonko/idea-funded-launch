-- =====================================================
-- PAYMENT PROVIDERS SYSTEM - Multi-Provider Payment Gateway
-- =====================================================

-- 1. Create payment_providers table
CREATE TABLE public.payment_providers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_key TEXT UNIQUE NOT NULL, -- 'maishapay', 'pawapay'
  display_name TEXT NOT NULL,
  is_enabled BOOLEAN DEFAULT false,
  is_default BOOLEAN DEFAULT false,
  supported_countries TEXT[] DEFAULT '{}',
  supported_methods TEXT[] DEFAULT '{MOBILE_MONEY}',
  priority INTEGER DEFAULT 100, -- Lower = higher priority
  config_public JSONB DEFAULT '{}', -- Non-sensitive: mode, labels, UI hints
  secret_refs JSONB DEFAULT '{}', -- References to secrets ONLY (not actual secrets)
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 2. Create payments table (provider-agnostic transaction log)
CREATE TABLE public.payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  provider_key TEXT NOT NULL,
  status TEXT DEFAULT 'created' CHECK (status IN ('created', 'pending', 'succeeded', 'failed', 'cancelled', 'refunded')),
  amount NUMERIC NOT NULL,
  currency TEXT NOT NULL,
  customer_phone TEXT,
  country TEXT DEFAULT 'COD',
  reference TEXT UNIQUE NOT NULL, -- 'AFRISHOP-xxxx'
  provider_deposit_id TEXT, -- pawaPay depositId or MaishaPay session ref
  provider_transaction_id TEXT, -- Provider's final transaction reference
  raw_request JSONB, -- Outgoing request to provider
  raw_events JSONB DEFAULT '[]'::jsonb, -- Array of callback payloads received
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  paid_at TIMESTAMPTZ
);

-- Unique constraint for idempotency on provider + deposit ID
CREATE UNIQUE INDEX idx_payments_provider_deposit ON public.payments (provider_key, provider_deposit_id) 
  WHERE provider_deposit_id IS NOT NULL;

-- Index for order lookups
CREATE INDEX idx_payments_order_id ON public.payments (order_id);
CREATE INDEX idx_payments_reference ON public.payments (reference);
CREATE INDEX idx_payments_status ON public.payments (status);

-- 3. Create payment_events table (audit trail)
CREATE TABLE public.payment_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id UUID REFERENCES payments(id) ON DELETE CASCADE,
  provider_key TEXT NOT NULL,
  event_type TEXT NOT NULL, -- 'initiated', 'callback_received', 'status_updated', 'verified'
  event_id TEXT, -- Provider's event ID for idempotency
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Unique constraint for idempotent event processing
CREATE UNIQUE INDEX idx_payment_events_idempotency ON public.payment_events (provider_key, event_id) 
  WHERE event_id IS NOT NULL;

CREATE INDEX idx_payment_events_payment_id ON public.payment_events (payment_id);

-- 4. Enable RLS on all tables
ALTER TABLE public.payment_providers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_events ENABLE ROW LEVEL SECURITY;

-- 5. RLS Policies for payment_providers (admin only for write, public read for enabled)
CREATE POLICY "Admins can manage payment providers"
  ON public.payment_providers
  FOR ALL
  USING (public.is_admin());

CREATE POLICY "Anyone can view enabled payment providers"
  ON public.payment_providers
  FOR SELECT
  USING (is_enabled = true);

-- 6. RLS Policies for payments
CREATE POLICY "Admins can view all payments"
  ON public.payments
  FOR ALL
  USING (public.is_admin());

CREATE POLICY "Users can view their own payments"
  ON public.payments
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM orders o 
      WHERE o.id = payments.order_id 
      AND o.user_id = auth.uid()
    )
  );

-- 7. RLS Policies for payment_events
CREATE POLICY "Admins can view all payment events"
  ON public.payment_events
  FOR ALL
  USING (public.is_admin());

CREATE POLICY "Users can view their own payment events"
  ON public.payment_events
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM payments p
      JOIN orders o ON o.id = p.order_id
      WHERE p.id = payment_events.payment_id
      AND o.user_id = auth.uid()
    )
  );

-- 8. Create trigger for updated_at
CREATE TRIGGER update_payment_providers_updated_at
  BEFORE UPDATE ON public.payment_providers
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at();

CREATE TRIGGER update_payments_updated_at
  BEFORE UPDATE ON public.payments
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at();

-- 9. Function to ensure only one default provider
CREATE OR REPLACE FUNCTION public.ensure_single_default_provider()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.is_default = true THEN
    UPDATE public.payment_providers 
    SET is_default = false 
    WHERE id != NEW.id AND is_default = true;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER ensure_single_default_provider_trigger
  BEFORE INSERT OR UPDATE ON public.payment_providers
  FOR EACH ROW
  WHEN (NEW.is_default = true)
  EXECUTE FUNCTION public.ensure_single_default_provider();

-- 10. Seed MaishaPay as the current default provider
INSERT INTO public.payment_providers (
  provider_key, 
  display_name, 
  is_enabled, 
  is_default, 
  supported_countries, 
  supported_methods,
  priority,
  config_public, 
  secret_refs
) VALUES (
  'maishapay', 
  'MaishaPay', 
  true, 
  true, 
  ARRAY['COD'],
  ARRAY['MOBILE_MONEY', 'CARD'],
  100,
  '{"mode": "live", "max_usd": 5000, "max_cdf": 30000000}'::jsonb, 
  '{"public_key": "MAISHAPAY_PUBLIC_API_KEY", "secret_key": "MAISHAPAY_SECRET_API_KEY", "webhook_secret": "MAISHAPAY_WEBHOOK_SECRET"}'::jsonb
);

-- 11. Seed pawaPay as disabled (ready for activation)
INSERT INTO public.payment_providers (
  provider_key, 
  display_name, 
  is_enabled, 
  is_default, 
  supported_countries, 
  supported_methods,
  priority,
  config_public, 
  secret_refs
) VALUES (
  'pawapay', 
  'pawaPay', 
  false, 
  false, 
  ARRAY['COD'],
  ARRAY['MOBILE_MONEY'],
  50, -- Higher priority than MaishaPay when enabled
  '{"mode": "sandbox", "api_base": "https://api.sandbox.pawapay.io"}'::jsonb, 
  '{"api_token": "PAWAPAY_API_TOKEN"}'::jsonb
);