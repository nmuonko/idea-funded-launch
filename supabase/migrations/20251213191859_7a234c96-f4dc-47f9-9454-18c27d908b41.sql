-- PROFILE RELIABILITY: Ensure every user has a profile row
-- This improves the existing trigger to handle edge cases

-- 1. Drop and recreate the trigger function with better handling
CREATE OR REPLACE FUNCTION public.handle_new_user_profile()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  default_country TEXT := 'DR Congo';
  default_language TEXT := 'fr';
  user_full_name TEXT;
BEGIN
  -- Extract full_name from various metadata fields (email/password + SSO providers)
  user_full_name := COALESCE(
    NULLIF(TRIM(NEW.raw_user_meta_data->>'full_name'), ''),
    NULLIF(TRIM(NEW.raw_user_meta_data->>'name'), ''),
    NULLIF(TRIM(NEW.raw_user_meta_data->>'given_name' || ' ' || COALESCE(NEW.raw_user_meta_data->>'family_name', '')), ''),
    NULLIF(TRIM(NEW.raw_user_meta_data->>'display_name'), ''),
    NULLIF(TRIM(NEW.raw_user_meta_data->>'preferred_username'), ''),
    split_part(NEW.email, '@', 1)
  );
  
  -- Upsert profile to handle both new users and SSO sign-ins
  INSERT INTO public.profiles (
    user_id, 
    email, 
    full_name, 
    name,
    country, 
    language
  )
  VALUES (
    NEW.id,
    NEW.email,
    user_full_name,
    user_full_name,
    default_country,
    default_language
  )
  ON CONFLICT (user_id) DO UPDATE
  SET 
    email = COALESCE(EXCLUDED.email, profiles.email),
    full_name = COALESCE(NULLIF(TRIM(profiles.full_name), ''), EXCLUDED.full_name),
    name = COALESCE(NULLIF(TRIM(profiles.name), ''), EXCLUDED.name);
  
  RETURN NEW;
END;
$$;

-- 2. Ensure trigger exists for BOTH insert and update on auth.users
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP TRIGGER IF EXISTS on_auth_user_updated ON auth.users;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user_profile();

CREATE TRIGGER on_auth_user_updated
  AFTER UPDATE ON auth.users
  FOR EACH ROW 
  WHEN (OLD.email IS DISTINCT FROM NEW.email OR OLD.raw_user_meta_data IS DISTINCT FROM NEW.raw_user_meta_data)
  EXECUTE FUNCTION public.handle_new_user_profile();

-- 3. Ensure RLS policies exist for profiles table (user can SELECT/UPDATE their own)
-- First, drop conflicting policies if they exist to avoid duplicates
DO $$
BEGIN
  -- These may already exist, so we use IF EXISTS pattern
  DROP POLICY IF EXISTS "Users can view their own profile" ON public.profiles;
  DROP POLICY IF EXISTS "Users can update their own profile" ON public.profiles;
  DROP POLICY IF EXISTS "Users can insert their own profile" ON public.profiles;
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

-- Recreate the policies
CREATE POLICY "Users can view their own profile" ON public.profiles
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can update their own profile" ON public.profiles
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own profile" ON public.profiles
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- 4. Backfill missing profiles for any existing users without one
INSERT INTO public.profiles (user_id, email, full_name, name, country, language)
SELECT 
  u.id,
  u.email,
  COALESCE(
    NULLIF(TRIM(u.raw_user_meta_data->>'full_name'), ''),
    NULLIF(TRIM(u.raw_user_meta_data->>'name'), ''),
    split_part(u.email, '@', 1)
  ),
  COALESCE(
    NULLIF(TRIM(u.raw_user_meta_data->>'full_name'), ''),
    NULLIF(TRIM(u.raw_user_meta_data->>'name'), ''),
    split_part(u.email, '@', 1)
  ),
  'DR Congo',
  'fr'
FROM auth.users u
WHERE NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = u.id)
ON CONFLICT (user_id) DO NOTHING;