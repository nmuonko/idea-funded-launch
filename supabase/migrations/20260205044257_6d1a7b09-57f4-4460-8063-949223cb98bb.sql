-- ============================================
-- FIX 1: Payment tables - enforce can_view_payments permission
-- ============================================

-- Fix payments table policy (joins through orders for user check)
DROP POLICY IF EXISTS "Admins can view all payments" ON payments;
DROP POLICY IF EXISTS "Users can view own payments" ON payments;

CREATE POLICY "Authorized users can view payments"
ON payments FOR SELECT USING (
  -- User can view payments for their own orders
  EXISTS (
    SELECT 1 FROM orders 
    WHERE orders.id = payments.order_id 
    AND orders.user_id = auth.uid()
  )
  OR
  (
    -- Admin role check with granular permissions
    public.has_role(auth.uid(), 'admin') AND (
      -- Super admins always have access
      EXISTS (
        SELECT 1 FROM user_roles 
        WHERE user_roles.user_id = auth.uid() 
        AND admin_role = 'super_admin'
      )
      OR
      -- Admins with explicit can_view_payments permission
      EXISTS (
        SELECT 1 FROM admin_user_permissions
        WHERE admin_user_permissions.user_id = auth.uid()
        AND can_view_payments = true
      )
    )
  )
);

-- Fix maisha_payments table policy
DROP POLICY IF EXISTS "Admins can view all payments" ON maisha_payments;
DROP POLICY IF EXISTS "Users can view own maisha payments" ON maisha_payments;

CREATE POLICY "Authorized users can view maisha payments"
ON maisha_payments FOR SELECT USING (
  -- User can view their own payments
  auth.uid() = user_id
  OR
  (
    public.has_role(auth.uid(), 'admin') AND (
      EXISTS (
        SELECT 1 FROM user_roles 
        WHERE user_roles.user_id = auth.uid() 
        AND admin_role = 'super_admin'
      )
      OR
      EXISTS (
        SELECT 1 FROM admin_user_permissions
        WHERE admin_user_permissions.user_id = auth.uid()
        AND can_view_payments = true
      )
    )
  )
);

-- Fix checkout_sessions table policy
DROP POLICY IF EXISTS "Admins can view all checkout sessions" ON checkout_sessions;
DROP POLICY IF EXISTS "Users can view own checkout sessions" ON checkout_sessions;

CREATE POLICY "Authorized users can view checkout sessions"
ON checkout_sessions FOR SELECT USING (
  -- User can view their own sessions
  auth.uid() = user_id
  OR
  (
    public.has_role(auth.uid(), 'admin') AND (
      EXISTS (
        SELECT 1 FROM user_roles 
        WHERE user_roles.user_id = auth.uid() 
        AND admin_role = 'super_admin'
      )
      OR
      EXISTS (
        SELECT 1 FROM admin_user_permissions
        WHERE admin_user_permissions.user_id = auth.uid()
        AND can_view_payments = true
      )
    )
  )
);

-- Fix payment_attempts table policy
DROP POLICY IF EXISTS "Admins can view payment attempts" ON payment_attempts;
DROP POLICY IF EXISTS "Users can view own payment attempts" ON payment_attempts;

CREATE POLICY "Authorized users can view payment attempts"
ON payment_attempts FOR SELECT USING (
  -- User can view their own attempts
  auth.uid() = user_id
  OR
  (
    public.has_role(auth.uid(), 'admin') AND (
      EXISTS (
        SELECT 1 FROM user_roles 
        WHERE user_roles.user_id = auth.uid() 
        AND admin_role = 'super_admin'
      )
      OR
      EXISTS (
        SELECT 1 FROM admin_user_permissions
        WHERE admin_user_permissions.user_id = auth.uid()
        AND can_view_payments = true
      )
    )
  )
);

-- ============================================
-- FIX 2: Profiles table - block anonymous access
-- ============================================

-- Drop any overly permissive policies
DROP POLICY IF EXISTS "Public profiles are viewable by everyone" ON profiles;
DROP POLICY IF EXISTS "Profiles are viewable by everyone" ON profiles;
DROP POLICY IF EXISTS "Anyone can view profiles" ON profiles;
DROP POLICY IF EXISTS "Authenticated users can view own profile" ON profiles;
DROP POLICY IF EXISTS "Authorized admins can view all profiles" ON profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON profiles;
DROP POLICY IF EXISTS "Users can insert own profile" ON profiles;

-- Ensure RLS is enabled
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- Create policy requiring authentication for viewing own profile
CREATE POLICY "Users can view own profile"
ON profiles FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

-- Admins with can_view_customers permission can view all profiles
CREATE POLICY "Authorized admins can view all profiles"
ON profiles FOR SELECT
TO authenticated
USING (
  public.has_role(auth.uid(), 'admin') AND (
    EXISTS (
      SELECT 1 FROM user_roles 
      WHERE user_roles.user_id = auth.uid() 
      AND admin_role = 'super_admin'
    )
    OR
    EXISTS (
      SELECT 1 FROM admin_user_permissions
      WHERE admin_user_permissions.user_id = auth.uid()
      AND can_view_customers = true
    )
  )
);

-- Users can update their own profile
CREATE POLICY "Users can update own profile"
ON profiles FOR UPDATE
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- Users can insert their own profile
CREATE POLICY "Users can insert own profile"
ON profiles FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);