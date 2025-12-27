-- Create bank_transfer_view_tokens table for secure URL access
CREATE TABLE IF NOT EXISTS public.bank_transfer_view_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token text UNIQUE NOT NULL,
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz DEFAULT now()
);

-- Create index on token for fast lookups
CREATE INDEX IF NOT EXISTS idx_bank_transfer_view_tokens_token ON public.bank_transfer_view_tokens(token);

-- Create index on expires_at for cleanup
CREATE INDEX IF NOT EXISTS idx_bank_transfer_view_tokens_expires_at ON public.bank_transfer_view_tokens(expires_at);

-- Enable RLS
ALTER TABLE public.bank_transfer_view_tokens ENABLE ROW LEVEL SECURITY;

-- No public access - only service role can access this table
-- This ensures tokens can only be validated via Edge Functions

-- Add bank_transfer_details to admin_settings if not exists
INSERT INTO public.admin_settings (key, value)
VALUES (
  'bank_transfer_details',
  '{"beneficiary_name":"AfriShop USA LLC","bank_name":"","account_number_or_iban":"","swift_bic":"","instructions_fr":"Mettez la référence dans le libellé du virement.","instructions_en":"Put the reference in the transfer description.","support_whatsapp":"","support_email":"support@afrishop-usa.com"}'
)
ON CONFLICT (key) DO NOTHING;

-- Drop existing policies if they exist (to avoid conflicts)
DROP POLICY IF EXISTS "Anyone can read bank transfer details" ON public.admin_settings;
DROP POLICY IF EXISTS "Admins can update admin settings" ON public.admin_settings;
DROP POLICY IF EXISTS "Admins can insert admin settings" ON public.admin_settings;

-- Enable RLS on admin_settings if not already enabled
ALTER TABLE public.admin_settings ENABLE ROW LEVEL SECURITY;

-- Anyone can read bank transfer details (needed for public page)
CREATE POLICY "Anyone can read bank transfer details"
ON public.admin_settings
FOR SELECT
USING (key = 'bank_transfer_details');

-- Admins can update admin settings
CREATE POLICY "Admins can update admin settings"
ON public.admin_settings
FOR UPDATE
USING (has_role(auth.uid(), 'admin'::app_role));

-- Admins can insert admin settings
CREATE POLICY "Admins can insert admin settings"
ON public.admin_settings
FOR INSERT
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- Admins can read all admin settings
CREATE POLICY "Admins can read all admin settings"
ON public.admin_settings
FOR SELECT
USING (has_role(auth.uid(), 'admin'::app_role));