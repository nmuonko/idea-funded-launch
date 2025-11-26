-- Seed admin user and initial settings

-- Insert settings row if it doesn't exist
INSERT INTO public.settings (
  service_fee_percent,
  shipping_base_fee_usd,
  shipping_percent,
  exchange_rate_usd_to_cdf
) VALUES (
  0.12,
  10.00,
  0.10,
  2800.00
)
ON CONFLICT (id) DO NOTHING;

-- Note: Admin user must be created via Supabase Auth dashboard or auth-register endpoint
-- Then add to admin_users table to grant admin role
-- Example email: admin@afrishop.local
-- Password should be set securely when creating the auth user