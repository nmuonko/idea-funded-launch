-- Migration 2: Create payment_attempts table with idempotency support

-- Create payment_attempts table
CREATE TABLE IF NOT EXISTS public.payment_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  order_id uuid REFERENCES public.orders(id) ON DELETE SET NULL,
  checkout_session_id uuid REFERENCES public.checkout_sessions(id) ON DELETE SET NULL,
  idempotency_key text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'paid', 'failed', 'expired', 'cancelled')),
  amount numeric(12,2) NOT NULL CHECK (amount > 0),
  currency text NOT NULL DEFAULT 'USD' CHECK (currency IN ('USD', 'CDF')),
  provider text DEFAULT 'maishapay',
  provider_ref text,
  cart_hash text NOT NULL,
  payment_method text DEFAULT 'MOBILE_MONEY',
  last_error text,
  attempt_count integer NOT NULL DEFAULT 1,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '30 minutes'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Add comment
COMMENT ON TABLE public.payment_attempts IS 'Tracks payment attempts for idempotency and preventing duplicate charges';

-- Create indexes for payment_attempts
CREATE INDEX IF NOT EXISTS idx_payment_attempts_user_id ON public.payment_attempts(user_id);
CREATE INDEX IF NOT EXISTS idx_payment_attempts_order_id ON public.payment_attempts(order_id);
CREATE INDEX IF NOT EXISTS idx_payment_attempts_checkout_session ON public.payment_attempts(checkout_session_id);
CREATE INDEX IF NOT EXISTS idx_payment_attempts_cart_hash ON public.payment_attempts(cart_hash);
CREATE INDEX IF NOT EXISTS idx_payment_attempts_status ON public.payment_attempts(status);
CREATE INDEX IF NOT EXISTS idx_payment_attempts_expires ON public.payment_attempts(expires_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_payment_attempts_created ON public.payment_attempts(created_at DESC);

-- Create trigger for updated_at
CREATE TRIGGER update_payment_attempts_updated_at
  BEFORE UPDATE ON public.payment_attempts
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at();

-- Enable RLS
ALTER TABLE public.payment_attempts ENABLE ROW LEVEL SECURITY;

-- RLS Policies for payment_attempts
-- Users can only SELECT their own attempts
CREATE POLICY "Users can view own payment attempts"
  ON public.payment_attempts
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- No INSERT/UPDATE/DELETE for authenticated users - service role only