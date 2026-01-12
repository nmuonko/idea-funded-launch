-- Drop existing policies on supported_countries
DROP POLICY IF EXISTS "Anyone can view active supported countries" ON public.supported_countries;
DROP POLICY IF EXISTS "Admins can manage supported countries" ON public.supported_countries;

-- Create separate policies for public and admin access

-- Public can view only active countries (for the public coverage map)
CREATE POLICY "Public can view active countries" 
ON public.supported_countries 
FOR SELECT 
USING (is_active = true);

-- Admins can view ALL countries (including inactive)
CREATE POLICY "Admins can view all countries" 
ON public.supported_countries 
FOR SELECT 
USING (
  EXISTS (
    SELECT 1 FROM admin_users 
    WHERE admin_users.email = (SELECT email FROM auth.users WHERE id = auth.uid())
  )
);

-- Admins can insert countries
CREATE POLICY "Admins can insert countries" 
ON public.supported_countries 
FOR INSERT 
WITH CHECK (
  EXISTS (
    SELECT 1 FROM admin_users 
    WHERE admin_users.email = (SELECT email FROM auth.users WHERE id = auth.uid())
  )
);

-- Admins can update countries
CREATE POLICY "Admins can update countries" 
ON public.supported_countries 
FOR UPDATE 
USING (
  EXISTS (
    SELECT 1 FROM admin_users 
    WHERE admin_users.email = (SELECT email FROM auth.users WHERE id = auth.uid())
  )
);

-- Admins can delete countries
CREATE POLICY "Admins can delete countries" 
ON public.supported_countries 
FOR DELETE 
USING (
  EXISTS (
    SELECT 1 FROM admin_users 
    WHERE admin_users.email = (SELECT email FROM auth.users WHERE id = auth.uid())
  )
);