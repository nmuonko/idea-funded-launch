-- 1. PROFILE SAFETY: Enhance the trigger to handle SSO users and ensure profiles always exist
-- Drop and recreate the function with better defaults and SSO handling

CREATE OR REPLACE FUNCTION public.handle_new_user_profile()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  default_country TEXT := 'DR Congo';
  default_language TEXT := 'fr';
  user_full_name TEXT;
BEGIN
  -- Extract full_name from metadata (works for both email/password and SSO)
  user_full_name := COALESCE(
    NEW.raw_user_meta_data->>'full_name',
    NEW.raw_user_meta_data->>'name',
    NEW.raw_user_meta_data->>'given_name',
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
    full_name = COALESCE(NULLIF(profiles.full_name, ''), EXCLUDED.full_name),
    name = COALESCE(NULLIF(profiles.name, ''), EXCLUDED.name);
  
  RETURN NEW;
END;
$$;

-- 2. Ensure RLS allows profile operations correctly (already exists but let's verify)
-- These are safe to run - they will just update if exists

DROP POLICY IF EXISTS "Users can view their own profile" ON public.profiles;
CREATE POLICY "Users can view their own profile" 
ON public.profiles 
FOR SELECT 
USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update their own profile" ON public.profiles;
CREATE POLICY "Users can update their own profile" 
ON public.profiles 
FOR UPDATE 
USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert their own profile" ON public.profiles;
CREATE POLICY "Users can insert their own profile" 
ON public.profiles 
FOR INSERT 
WITH CHECK (auth.uid() = user_id);

-- 3. Backfill any missing profiles for existing users
INSERT INTO public.profiles (user_id, email, full_name, name, country, language)
SELECT 
  u.id,
  u.email,
  COALESCE(
    u.raw_user_meta_data->>'full_name',
    u.raw_user_meta_data->>'name',
    split_part(u.email, '@', 1)
  ),
  COALESCE(
    u.raw_user_meta_data->>'full_name',
    u.raw_user_meta_data->>'name',
    split_part(u.email, '@', 1)
  ),
  'DR Congo',
  'fr'
FROM auth.users u
LEFT JOIN public.profiles p ON u.id = p.user_id
WHERE p.user_id IS NULL
ON CONFLICT (user_id) DO NOTHING;