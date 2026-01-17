-- Ensure bank_transfer provider row exists in payment_providers table
INSERT INTO public.payment_providers (
  provider_key, display_name, is_enabled, is_default, priority,
  supported_countries, supported_methods, config_public, secret_refs
)
VALUES (
  'bank_transfer', 'Bank Transfer', true, false, 250,
  ARRAY['COD']::text[], ARRAY['BANK_TRANSFER']::text[],
  '{"mode": "live"}'::jsonb, '{}'::jsonb
)
ON CONFLICT (provider_key) DO NOTHING;

-- Add defaults and NOT NULL constraints to payment_providers
ALTER TABLE public.payment_providers
  ALTER COLUMN is_enabled SET DEFAULT false,
  ALTER COLUMN is_default SET DEFAULT false,
  ALTER COLUMN priority SET DEFAULT 100,
  ALTER COLUMN supported_countries SET DEFAULT ARRAY[]::text[],
  ALTER COLUMN supported_methods SET DEFAULT ARRAY[]::text[],
  ALTER COLUMN config_public SET DEFAULT '{}'::jsonb,
  ALTER COLUMN secret_refs SET DEFAULT '{}'::jsonb;

-- Add NOT NULL where safe
ALTER TABLE public.payment_providers
  ALTER COLUMN is_enabled SET NOT NULL,
  ALTER COLUMN is_default SET NOT NULL,
  ALTER COLUMN priority SET NOT NULL;

-- Add defaults to bank_transfer_settings
ALTER TABLE public.bank_transfer_settings
  ALTER COLUMN is_active SET DEFAULT true,
  ALTER COLUMN beneficiary_name SET DEFAULT '',
  ALTER COLUMN bank_name SET DEFAULT '',
  ALTER COLUMN account_number_or_iban SET DEFAULT '';

-- Add defaults to payment_settings
ALTER TABLE public.payment_settings
  ALTER COLUMN pawapay_enabled SET DEFAULT true,
  ALTER COLUMN stripe_enabled SET DEFAULT false,
  ALTER COLUMN bank_transfer_enabled SET DEFAULT true,
  ALTER COLUMN mobile_money_max_usd SET DEFAULT 5000,
  ALTER COLUMN mobile_money_max_cdf SET DEFAULT 30000000,
  ALTER COLUMN large_order_currency SET DEFAULT 'USD';

-- Create updated_at trigger function if not exists
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- Add updated_at triggers to tables that need them
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'set_payment_providers_updated_at'
  ) THEN
    CREATE TRIGGER set_payment_providers_updated_at
      BEFORE UPDATE ON public.payment_providers
      FOR EACH ROW
      EXECUTE FUNCTION public.set_updated_at();
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'set_bank_transfer_settings_updated_at'
  ) THEN
    CREATE TRIGGER set_bank_transfer_settings_updated_at
      BEFORE UPDATE ON public.bank_transfer_settings
      FOR EACH ROW
      EXECUTE FUNCTION public.set_updated_at();
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'set_payment_settings_updated_at'
  ) THEN
    CREATE TRIGGER set_payment_settings_updated_at
      BEFORE UPDATE ON public.payment_settings
      FOR EACH ROW
      EXECUTE FUNCTION public.set_updated_at();
  END IF;
END $$;

-- Ensure at least one payment_settings row exists
INSERT INTO public.payment_settings (id)
VALUES (gen_random_uuid())
ON CONFLICT DO NOTHING;