-- P0: Create checkout_sessions table to track checkout attempts
-- This ensures server is single source of truth for payable totals

CREATE TABLE IF NOT EXISTS public.checkout_sessions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  order_id UUID REFERENCES public.orders(id) ON DELETE CASCADE,
  
  -- Cart snapshot (frozen at checkout time)
  cart_snapshot JSONB NOT NULL DEFAULT '[]'::jsonb,
  
  -- Totals breakdown (server-computed, single source of truth)
  totals_breakdown JSONB NOT NULL DEFAULT '{}'::jsonb,
  
  -- Payment details
  currency TEXT NOT NULL DEFAULT 'USD' CHECK (currency IN ('USD', 'CDF')),
  pay_method TEXT NOT NULL DEFAULT 'MOBILE_MONEY' CHECK (pay_method IN ('CARD', 'MOBILE_MONEY')),
  grand_total NUMERIC NOT NULL,
  
  -- Integrity hash (for verification that frontend didn't tamper)
  integrity_hash TEXT NOT NULL,
  
  -- MaishaPay reference and redirect URL
  maisha_reference TEXT,
  redirect_url TEXT,
  
  -- Status tracking
  status TEXT NOT NULL DEFAULT 'initiated' CHECK (status IN ('initiated', 'pending', 'paid', 'failed', 'cancelled', 'expired')),
  
  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  paid_at TIMESTAMP WITH TIME ZONE,
  
  -- Metadata for debugging
  metadata JSONB DEFAULT '{}'::jsonb
);

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_checkout_sessions_user_id ON public.checkout_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_checkout_sessions_order_id ON public.checkout_sessions(order_id);
CREATE INDEX IF NOT EXISTS idx_checkout_sessions_status ON public.checkout_sessions(status);
CREATE INDEX IF NOT EXISTS idx_checkout_sessions_maisha_reference ON public.checkout_sessions(maisha_reference);

-- Enable RLS
ALTER TABLE public.checkout_sessions ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view their own checkout sessions"
ON public.checkout_sessions
FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Service role can manage all checkout sessions"
ON public.checkout_sessions
FOR ALL
USING (true);

CREATE POLICY "Admins can view all checkout sessions"
ON public.checkout_sessions
FOR SELECT
USING (has_role(auth.uid(), 'admin'::app_role));

-- Trigger for updated_at
CREATE TRIGGER update_checkout_sessions_updated_at
BEFORE UPDATE ON public.checkout_sessions
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at();