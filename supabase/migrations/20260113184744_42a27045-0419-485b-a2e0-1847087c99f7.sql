-- Drop and recreate the admin view policy with a simpler check
DROP POLICY IF EXISTS "Admins can view all countries" ON public.supported_countries;

-- Create a more robust admin SELECT policy
CREATE POLICY "Admins can view all countries"
  ON public.supported_countries
  FOR SELECT
  USING (
    is_active = true
    OR
    EXISTS (
      SELECT 1 FROM public.admin_users au
      WHERE au.email = (SELECT email FROM auth.users WHERE id = auth.uid())
    )
  );