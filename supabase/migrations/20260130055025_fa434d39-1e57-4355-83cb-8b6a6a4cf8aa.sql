-- Fix: Customer PII should only be accessible to admins with can_view_customers permission or super_admins
-- The can_view_customer_profiles function already exists and checks both conditions

-- Drop the overly permissive policy
DROP POLICY IF EXISTS "Admins can view all profiles" ON public.profiles;

-- Create new policy that enforces granular permissions
-- Users can view their own profile OR admins with can_view_customers permission can view all
CREATE POLICY "Users and authorized admins can view profiles"
ON public.profiles FOR SELECT
USING (
  auth.uid() = user_id 
  OR public.can_view_customer_profiles(auth.uid())
);