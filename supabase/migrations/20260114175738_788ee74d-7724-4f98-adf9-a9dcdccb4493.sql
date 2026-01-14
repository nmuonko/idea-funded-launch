-- =============================================
-- Bank Transfer Settings Singleton Table
-- Single source of truth for bank transfer config
-- =============================================

-- Create the dedicated table
CREATE TABLE IF NOT EXISTS public.bank_transfer_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  is_active boolean NOT NULL DEFAULT true,
  beneficiary_name text NOT NULL DEFAULT '',
  bank_name text NOT NULL DEFAULT '',
  account_number_or_iban text NOT NULL DEFAULT '',
  swift_bic text,
  instructions_en text,
  instructions_fr text,
  support_email text,
  support_whatsapp text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Add comment for documentation
COMMENT ON TABLE public.bank_transfer_settings IS 'Singleton table for bank transfer configuration. Only one active row should exist.';

-- Create index for fast active row lookup
CREATE INDEX IF NOT EXISTS idx_bank_transfer_settings_active 
ON public.bank_transfer_settings(is_active) 
WHERE is_active = true;

-- Enable RLS
ALTER TABLE public.bank_transfer_settings ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Only admins can modify
CREATE POLICY "Admins can manage bank transfer settings"
ON public.bank_transfer_settings
FOR ALL
USING (public.is_admin())
WITH CHECK (public.is_admin());

-- RLS Policy: Service role can read (for edge functions)
-- Note: Edge functions use service role key which bypasses RLS

-- Trigger to update updated_at
CREATE TRIGGER update_bank_transfer_settings_updated_at
BEFORE UPDATE ON public.bank_transfer_settings
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at();

-- Insert initial data from existing admin_settings
INSERT INTO public.bank_transfer_settings (
  is_active,
  beneficiary_name,
  bank_name,
  account_number_or_iban,
  swift_bic,
  instructions_en,
  instructions_fr,
  support_email,
  support_whatsapp
)
SELECT 
  true,
  COALESCE((value::jsonb)->>'beneficiary_name', ''),
  COALESCE((value::jsonb)->>'bank_name', ''),
  COALESCE((value::jsonb)->>'account_number_or_iban', ''),
  (value::jsonb)->>'swift_bic',
  (value::jsonb)->>'instructions_en',
  (value::jsonb)->>'instructions_fr',
  (value::jsonb)->>'support_email',
  (value::jsonb)->>'support_whatsapp'
FROM public.admin_settings
WHERE key = 'bank_transfer_details'
ON CONFLICT DO NOTHING;