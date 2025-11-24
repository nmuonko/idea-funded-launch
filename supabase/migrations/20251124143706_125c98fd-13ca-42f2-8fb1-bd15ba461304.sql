-- Create payments table for tracking MaishaPay transactions
CREATE TABLE IF NOT EXISTS public.payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider TEXT NOT NULL DEFAULT 'maishapay',
  status TEXT NOT NULL,
  description TEXT,
  transaction_ref_id TEXT,
  operator_ref_id TEXT,
  amount NUMERIC,
  currency TEXT DEFAULT 'USD',
  submission_id UUID REFERENCES public.user_submissions(id) ON DELETE CASCADE,
  raw_payload JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add indexes for faster lookups
CREATE INDEX IF NOT EXISTS idx_payments_transaction_ref ON public.payments(transaction_ref_id);
CREATE INDEX IF NOT EXISTS idx_payments_submission_id ON public.payments(submission_id);
CREATE INDEX IF NOT EXISTS idx_payments_status ON public.payments(status);

-- Enable RLS
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;

-- Admins can view all payments
CREATE POLICY "Admins can view all payments" ON public.payments
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_roles.user_id = auth.uid()
      AND user_roles.role = 'admin'
    )
  );

-- Service role can manage payments (for edge function)
CREATE POLICY "Service role can manage payments" ON public.payments
  FOR ALL
  USING (auth.role() = 'service_role');

-- Trigger to update updated_at
CREATE OR REPLACE FUNCTION public.update_payments_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER payments_updated_at
  BEFORE UPDATE ON public.payments
  FOR EACH ROW
  EXECUTE FUNCTION public.update_payments_updated_at();