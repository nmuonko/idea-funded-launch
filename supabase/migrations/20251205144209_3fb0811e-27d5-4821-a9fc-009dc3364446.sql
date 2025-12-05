-- Simplify profiles table for AfriShop
-- Remove unused columns, rename for clarity

-- First, add new columns if they don't exist
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS address text,
ADD COLUMN IF NOT EXISTS province text;

-- Migrate data from old columns to new
UPDATE public.profiles 
SET 
  address = COALESCE(address_line1, '') || CASE WHEN address_line2 IS NOT NULL AND address_line2 != '' THEN ', ' || address_line2 ELSE '' END || CASE WHEN city IS NOT NULL AND city != '' THEN ', ' || city ELSE '' END,
  province = COALESCE(state_province, 'Kinshasa')
WHERE address IS NULL OR province IS NULL;

-- Set defaults for required fields on existing rows
UPDATE public.profiles
SET
  country = COALESCE(country, 'DR Congo'),
  province = COALESCE(province, 'Kinshasa'),
  language = COALESCE(language, 'fr'),
  full_name = COALESCE(full_name, name, 'User'),
  phone = COALESCE(phone, ''),
  address = COALESCE(address, '')
WHERE country IS NULL OR province IS NULL OR language IS NULL;

-- Create or replace function to get language from country
CREATE OR REPLACE FUNCTION public.get_language_for_country(p_country text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  french_countries text[] := ARRAY[
    'DR Congo', 'Congo-Brazzaville', 'Central African Republic', 'Cameroon', 
    'Burundi', 'Rwanda', 'Benin', 'Ivory Coast', 'Senegal', 'Mali', 
    'Chad', 'Niger', 'Gabon', 'Togo', 'Burkina Faso', 'Madagascar',
    'Guinea', 'Mauritius', 'Comoros', 'Djibouti', 'Seychelles'
  ];
  english_countries text[] := ARRAY[
    'Kenya', 'Uganda', 'Tanzania', 'Nigeria', 'Ghana', 'South Africa',
    'Zambia', 'Zimbabwe', 'Botswana', 'Namibia', 'Malawi', 'Liberia',
    'Sierra Leone', 'Gambia', 'Lesotho', 'Eswatini'
  ];
BEGIN
  IF p_country = ANY(french_countries) THEN
    RETURN 'fr';
  ELSIF p_country = ANY(english_countries) THEN
    RETURN 'en';
  ELSE
    RETURN 'fr'; -- Default to French
  END IF;
END;
$$;

-- Create trigger function to auto-set language based on country
CREATE OR REPLACE FUNCTION public.auto_set_profile_language()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only auto-set language if not explicitly provided and country is set
  IF NEW.language IS NULL AND NEW.country IS NOT NULL THEN
    NEW.language := public.get_language_for_country(NEW.country);
  END IF;
  RETURN NEW;
END;
$$;

-- Create trigger for auto-setting language (drop first if exists)
DROP TRIGGER IF EXISTS auto_set_language_on_profile ON public.profiles;
CREATE TRIGGER auto_set_language_on_profile
  BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_set_profile_language();