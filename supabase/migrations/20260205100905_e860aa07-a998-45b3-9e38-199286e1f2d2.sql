-- ============================================================
-- SECURITY FIX: Tighten RLS policies for profiles and orders
-- ============================================================

-- Drop existing overly permissive SELECT policies on profiles
DROP POLICY IF EXISTS "Admins can view all profiles" ON public.profiles;
DROP POLICY IF EXISTS "Authorized admins can view all profiles" ON public.profiles;
DROP POLICY IF EXISTS "Users and authorized admins can view profiles" ON public.profiles;
DROP POLICY IF EXISTS "Admins with customer permission can view profiles" ON public.profiles;
DROP POLICY IF EXISTS "Users can view own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can view their own profile" ON public.profiles;

-- Create single consolidated SELECT policy for profiles with proper authorization
CREATE POLICY "profiles_select_policy"
ON public.profiles
FOR SELECT
TO authenticated
USING (
  -- Users can always view their own profile
  auth.uid() = user_id
  OR
  -- Admins need super_admin role OR explicit can_view_customers permission
  (
    has_role(auth.uid(), 'admin'::app_role)
    AND (
      EXISTS (
        SELECT 1 FROM public.user_roles
        WHERE user_roles.user_id = auth.uid()
        AND user_roles.admin_role = 'super_admin'
      )
      OR EXISTS (
        SELECT 1 FROM public.admin_user_permissions
        WHERE admin_user_permissions.user_id = auth.uid()
        AND admin_user_permissions.can_view_customers = true
      )
    )
  )
);

-- Drop existing overly permissive SELECT policies on orders
DROP POLICY IF EXISTS "Admins can view all orders" ON public.orders;
DROP POLICY IF EXISTS "Users can view their own orders" ON public.orders;

-- Create single consolidated SELECT policy for orders with proper authorization
CREATE POLICY "orders_select_policy"
ON public.orders
FOR SELECT
TO authenticated
USING (
  -- Users can always view their own orders
  auth.uid() = user_id
  OR
  -- Admins need super_admin role OR explicit can_view_orders permission
  (
    has_role(auth.uid(), 'admin'::app_role)
    AND (
      EXISTS (
        SELECT 1 FROM public.user_roles
        WHERE user_roles.user_id = auth.uid()
        AND user_roles.admin_role = 'super_admin'
      )
      OR EXISTS (
        SELECT 1 FROM public.admin_user_permissions
        WHERE admin_user_permissions.user_id = auth.uid()
        AND admin_user_permissions.can_view_orders = true
      )
    )
  )
);