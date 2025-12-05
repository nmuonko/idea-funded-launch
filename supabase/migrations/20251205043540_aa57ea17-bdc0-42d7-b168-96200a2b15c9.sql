-- Add address columns to profiles table for enhanced user onboarding
ALTER TABLE public.profiles 
  ADD COLUMN IF NOT EXISTS address_line1 text,
  ADD COLUMN IF NOT EXISTS address_line2 text,
  ADD COLUMN IF NOT EXISTS city text,
  ADD COLUMN IF NOT EXISTS state_province text,
  ADD COLUMN IF NOT EXISTS postal_code text,
  ADD COLUMN IF NOT EXISTS country text;

-- Add comments for documentation
COMMENT ON COLUMN public.profiles.address_line1 IS 'Primary address line (street address)';
COMMENT ON COLUMN public.profiles.address_line2 IS 'Secondary address line (apt, suite, etc.)';
COMMENT ON COLUMN public.profiles.city IS 'City name';
COMMENT ON COLUMN public.profiles.state_province IS 'State or province';
COMMENT ON COLUMN public.profiles.postal_code IS 'Postal/ZIP code';
COMMENT ON COLUMN public.profiles.country IS 'Country name or ISO code';