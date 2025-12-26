-- =====================================================
-- Payment Links Table for Public Vehicle Quote Payments
-- =====================================================

-- Create payment_links table
CREATE TABLE public.payment_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token text UNIQUE NOT NULL DEFAULT encode(extensions.gen_random_bytes(24), 'hex'),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'used', 'expired')),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  created_at timestamptz NOT NULL DEFAULT now(),
  used_at timestamptz,
  created_by uuid
);

-- Indexes
CREATE INDEX idx_payment_links_order_id ON public.payment_links(order_id);
CREATE INDEX idx_payment_links_expires_at ON public.payment_links(expires_at) WHERE status = 'active';
CREATE INDEX idx_payment_links_status ON public.payment_links(status);

-- Enable RLS
ALTER TABLE public.payment_links ENABLE ROW LEVEL SECURITY;

-- RLS: Only service role can access (edge functions)
-- No direct public access - must go through edge functions

-- Admins can view all payment links
CREATE POLICY "Admins can view payment links"
  ON public.payment_links
  FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'::app_role));

-- =====================================================
-- Add Bank Payment Settings to settings table
-- =====================================================

-- Add bank payment columns to settings
ALTER TABLE public.settings
  ADD COLUMN IF NOT EXISTS bank_name text DEFAULT 'Rawbank',
  ADD COLUMN IF NOT EXISTS bank_account_holder text DEFAULT 'AfriShop USA LLC',
  ADD COLUMN IF NOT EXISTS bank_account_number text DEFAULT '',
  ADD COLUMN IF NOT EXISTS bank_swift text DEFAULT '',
  ADD COLUMN IF NOT EXISTS bank_iban text,
  ADD COLUMN IF NOT EXISTS bank_address text,
  ADD COLUMN IF NOT EXISTS bank_instructions_fr text DEFAULT 'Veuillez effectuer le virement bancaire en utilisant la référence de commande indiquée. Une fois le paiement effectué, envoyez la preuve de paiement via WhatsApp ou email.',
  ADD COLUMN IF NOT EXISTS bank_instructions_en text DEFAULT 'Please make the bank transfer using the order reference indicated. Once payment is made, send proof of payment via WhatsApp or email.',
  ADD COLUMN IF NOT EXISTS support_whatsapp text DEFAULT '+1-XXX-XXX-XXXX',
  ADD COLUMN IF NOT EXISTS support_email text DEFAULT 'payments@afrishop-usa.com',
  ADD COLUMN IF NOT EXISTS maishapay_max_usd numeric DEFAULT 5000,
  ADD COLUMN IF NOT EXISTS maishapay_max_cdf numeric DEFAULT 30000000;

-- Comment on new columns
COMMENT ON COLUMN public.settings.maishapay_max_usd IS 'Maximum USD amount for MaishaPay checkout';
COMMENT ON COLUMN public.settings.maishapay_max_cdf IS 'Maximum CDF amount for MaishaPay checkout';
COMMENT ON COLUMN public.settings.bank_instructions_fr IS 'French instructions for manual bank payment';
COMMENT ON COLUMN public.settings.bank_instructions_en IS 'English instructions for manual bank payment';