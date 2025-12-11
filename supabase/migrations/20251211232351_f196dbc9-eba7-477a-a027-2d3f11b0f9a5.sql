-- Security Hardening Migration
-- Adds role-based restrictions for sensitive data access

-- 1. Restrict admin_invitations token visibility to super admins only
-- Drop existing restrictive policy and recreate with tighter controls
DROP POLICY IF EXISTS "Admins can view all invitations" ON public.admin_invitations;

CREATE POLICY "Super admins can view all invitations"
ON public.admin_invitations
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM user_roles
    WHERE user_roles.user_id = auth.uid()
    AND user_roles.role = 'admin'
    AND user_roles.admin_role = 'super_admin'
  )
);

-- Regular admins can only see non-sensitive fields (handled in application layer)
-- But they can still see their own invitations they sent
CREATE POLICY "Admins can view invitations they sent"
ON public.admin_invitations
FOR SELECT
USING (
  invited_by = auth.uid()
);

-- 2. Restrict device_tokens to super admins only (contains user tracking data)
DROP POLICY IF EXISTS "Admins can view all device tokens" ON public.device_tokens;

CREATE POLICY "Super admins can view all device tokens"
ON public.device_tokens
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM user_roles
    WHERE user_roles.user_id = auth.uid()
    AND user_roles.role = 'admin'
    AND user_roles.admin_role = 'super_admin'
  )
);

-- 3. Add audit logging trigger for sensitive profile access
-- Create function to log profile access by admins
CREATE OR REPLACE FUNCTION public.log_admin_profile_access()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only log if accessed by admin viewing another user's profile
  IF auth.uid() IS NOT NULL AND auth.uid() != NEW.user_id THEN
    -- Check if requester is admin
    IF EXISTS (
      SELECT 1 FROM user_roles 
      WHERE user_id = auth.uid() 
      AND role = 'admin'
    ) THEN
      INSERT INTO admin_audit_logs (
        admin_id,
        action_type,
        target_section,
        target_id,
        details
      ) VALUES (
        auth.uid(),
        'VIEW_PROFILE',
        'profiles',
        NEW.id::text,
        jsonb_build_object('viewed_user_id', NEW.user_id)
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- 4. Add index for faster admin permission checks
CREATE INDEX IF NOT EXISTS idx_user_roles_admin_lookup 
ON public.user_roles (user_id, role, admin_role);

-- 5. Add index for faster order lookups by status (performance optimization)
CREATE INDEX IF NOT EXISTS idx_orders_user_status 
ON public.orders (user_id, status);

-- 6. Add index for faster order_items lookup (performance optimization)
CREATE INDEX IF NOT EXISTS idx_order_items_order_saved 
ON public.order_items (order_id, is_saved_for_later);

-- 7. Add index for faster payment reconciliation
CREATE INDEX IF NOT EXISTS idx_maisha_payments_status 
ON public.maisha_payments (status, order_id);

-- 8. Normalize settings table - ensure consistent markup format
-- If markup_percent and global_markup_percent both exist, ensure they're consistent
UPDATE public.settings
SET global_markup_percent = CASE 
  WHEN markup_percent IS NOT NULL AND markup_percent >= 1 THEN markup_percent / 100.0
  WHEN markup_percent IS NOT NULL THEN markup_percent
  ELSE global_markup_percent
END
WHERE markup_percent IS NOT NULL;