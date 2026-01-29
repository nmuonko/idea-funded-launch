-- Create function to check if admin has customer viewing permission
CREATE OR REPLACE FUNCTION public.can_view_customer_profiles(user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  -- Super admins can always view customer profiles
  SELECT EXISTS (
    SELECT 1 FROM user_roles
    WHERE user_roles.user_id = can_view_customer_profiles.user_id
    AND admin_role = 'super_admin'
  )
  OR EXISTS (
    -- Admins with explicit can_view_customers permission
    SELECT 1 FROM admin_user_permissions
    WHERE admin_user_permissions.user_id = can_view_customer_profiles.user_id
    AND can_view_customers = true
  );
$$;

-- Drop the existing overly permissive policy
DROP POLICY IF EXISTS "Admins can view all profiles" ON public.profiles;

-- Create new policy that enforces the can_view_customers permission
CREATE POLICY "Admins with customer permission can view profiles"
ON public.profiles 
FOR SELECT
USING (
  -- Users can always view their own profile
  auth.uid() = user_id
  OR
  -- Admins with proper permissions can view all profiles
  (
    has_role(auth.uid(), 'admin'::app_role) AND
    can_view_customer_profiles(auth.uid())
  )
);