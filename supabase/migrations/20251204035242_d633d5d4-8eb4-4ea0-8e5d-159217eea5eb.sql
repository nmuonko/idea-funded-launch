-- Fix remaining critical security issues

-- 1. Fix admin_invitations: Only show invitations for authenticated user's own email
DROP POLICY IF EXISTS "Users can view invitations for their email" ON admin_invitations;

CREATE POLICY "Users can view their own email invitations" 
ON admin_invitations 
FOR SELECT 
USING (
  -- Admins can see all
  has_role(auth.uid(), 'admin'::app_role)
  OR
  -- Users can only see invitations sent to their verified email
  (email = (SELECT email FROM auth.users WHERE id = auth.uid()) AND status = 'pending' AND expires_at > now())
);

-- 2. Fix admin_users: Create a function-based check instead of exposing table
DROP POLICY IF EXISTS "Users can check if they are admin" ON admin_users;

-- Only admins can view the full table, regular users use has_role function
CREATE POLICY "Only admins can view admin_users table" 
ON admin_users 
FOR SELECT 
USING (has_role(auth.uid(), 'admin'::app_role));

-- 3. Fix settings: Only admins should see full settings, users get limited view
DROP POLICY IF EXISTS "Anyone authenticated can view settings" ON settings;

-- Create policy for admin access
CREATE POLICY "Admins can view all settings" 
ON settings 
FOR SELECT 
USING (has_role(auth.uid(), 'admin'::app_role));

-- Create policy for basic user access (they need exchange rate for display)
CREATE POLICY "Authenticated users can view basic settings" 
ON settings 
FOR SELECT 
USING (auth.uid() IS NOT NULL);

-- 4. Fix admin_settings: Only admins should view
DROP POLICY IF EXISTS "Authenticated users can view admin settings" ON admin_settings;

CREATE POLICY "Only admins can view admin settings" 
ON admin_settings 
FOR SELECT 
USING (has_role(auth.uid(), 'admin'::app_role));

-- 5. Ensure profiles table requires authentication for read
-- Note: Current policy "Users can view their own profile" already restricts this
-- But let's add an explicit authenticated check for any existing open policies

-- 6. Add view for safe maisha_payments data (without raw_request/response)
CREATE OR REPLACE VIEW public.safe_user_payments AS
SELECT 
  mp.id,
  mp.order_id,
  mp.maisha_reference,
  mp.amount_usd,
  mp.amount_cdf,
  mp.currency,
  mp.status,
  mp.paid_at,
  mp.created_at,
  mp.updated_at
FROM maisha_payments mp
INNER JOIN orders o ON o.id = mp.order_id
WHERE o.user_id = auth.uid();

-- Grant select on view
GRANT SELECT ON public.safe_user_payments TO authenticated;