-- Add explicit anonymous access blocking policy to profiles table
-- This ensures unauthenticated requests cannot access any profile data

CREATE POLICY "Block anonymous access on profiles"
ON public.profiles
FOR ALL
USING (auth.uid() IS NOT NULL);

-- Add explicit anonymous access blocking policy to admin_users table
CREATE POLICY "Block anonymous access on admin_users"
ON public.admin_users
FOR ALL
USING (auth.uid() IS NOT NULL);