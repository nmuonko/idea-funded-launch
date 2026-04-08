
-- Create a security definer function to check admin permissions
CREATE OR REPLACE FUNCTION public.admin_has_permission(check_user_id uuid, permission_name text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.admin_user_permissions
    WHERE user_id = check_user_id
      AND (
        CASE permission_name
          WHEN 'can_view_customers' THEN can_view_customers
          WHEN 'can_view_orders' THEN can_view_orders
          WHEN 'can_view_payments' THEN can_view_payments
          WHEN 'can_manage_users' THEN can_manage_users
          WHEN 'can_view_settings' THEN can_view_settings
          ELSE false
        END
      ) = true
  );
$$;

-- Drop the overly broad admin policy
DROP POLICY IF EXISTS "Admins can manage referrers" ON public.referrers;

-- Create scoped admin read policy: only admins with can_view_customers
CREATE POLICY "Admins with customer permission can view referrers"
  ON public.referrers
  FOR SELECT
  TO authenticated
  USING (
    is_admin(auth.uid()) AND (
      -- Super admins (no permissions row) or admins with can_view_customers
      NOT EXISTS (SELECT 1 FROM admin_user_permissions WHERE user_id = auth.uid())
      OR admin_has_permission(auth.uid(), 'can_view_customers')
    )
  );

-- Create scoped admin write policy: only admins with can_manage_users
CREATE POLICY "Admins with manage permission can modify referrers"
  ON public.referrers
  FOR ALL
  TO authenticated
  USING (
    is_admin(auth.uid()) AND (
      NOT EXISTS (SELECT 1 FROM admin_user_permissions WHERE user_id = auth.uid())
      OR admin_has_permission(auth.uid(), 'can_manage_users')
    )
  )
  WITH CHECK (
    is_admin(auth.uid()) AND (
      NOT EXISTS (SELECT 1 FROM admin_user_permissions WHERE user_id = auth.uid())
      OR admin_has_permission(auth.uid(), 'can_manage_users')
    )
  );
