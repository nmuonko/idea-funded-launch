-- Drop existing problematic policies
DROP POLICY IF EXISTS "Public can view active countries" ON public.supported_countries;
DROP POLICY IF EXISTS "Admins can view all countries" ON public.supported_countries;
DROP POLICY IF EXISTS "Admins can insert countries" ON public.supported_countries;
DROP POLICY IF EXISTS "Admins can update countries" ON public.supported_countries;
DROP POLICY IF EXISTS "Admins can delete countries" ON public.supported_countries;

-- Create new policies using is_admin() function (which uses user_roles, not auth.users)
-- Public users can view active countries
CREATE POLICY "Public can view active countries" 
ON public.supported_countries 
FOR SELECT 
USING (is_active = true);

-- Admins can view all countries (active and inactive)
CREATE POLICY "Admins can view all countries" 
ON public.supported_countries 
FOR SELECT 
USING (public.is_admin());

-- Admins can insert countries
CREATE POLICY "Admins can insert countries" 
ON public.supported_countries 
FOR INSERT 
WITH CHECK (public.is_admin());

-- Admins can update countries
CREATE POLICY "Admins can update countries" 
ON public.supported_countries 
FOR UPDATE 
USING (public.is_admin());

-- Admins can delete countries
CREATE POLICY "Admins can delete countries" 
ON public.supported_countries 
FOR DELETE 
USING (public.is_admin());