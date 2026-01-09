-- Insert Stripe provider
INSERT INTO payment_providers (provider_key, display_name, is_enabled, is_default, supported_countries, supported_methods, priority, config_public, secret_refs)
VALUES (
  'stripe',
  'Stripe',
  false,
  false,
  '{}',
  ARRAY['CARD'],
  200,
  '{"mode": "sandbox"}'::jsonb,
  '{"secret_key": "STRIPE_SECRET_KEY", "webhook_secret": "STRIPE_WEBHOOK_SECRET"}'::jsonb
)
ON CONFLICT (provider_key) DO NOTHING;

-- Insert AvadaPay stub provider
INSERT INTO payment_providers (provider_key, display_name, is_enabled, is_default, supported_countries, supported_methods, priority, config_public, secret_refs)
VALUES (
  'avadapay',
  'AvadaPay',
  false,
  false,
  ARRAY['COD'],
  ARRAY['MOBILE_MONEY'],
  300,
  '{"status": "coming_soon"}'::jsonb,
  '{"api_key": "AVADAPAY_API_KEY", "secret_key": "AVADAPAY_SECRET_KEY"}'::jsonb
)
ON CONFLICT (provider_key) DO NOTHING;

-- Add client_secret column to payments table for Stripe
ALTER TABLE payments ADD COLUMN IF NOT EXISTS client_secret TEXT;

-- Add car_threshold_usd to admin_settings if not exists
INSERT INTO admin_settings (key, value)
VALUES ('car_threshold_usd', '10000')
ON CONFLICT (key) DO NOTHING;