-- Add audit logging trigger for device_tokens bulk access by super admins
-- This logs when admins access device tokens for security monitoring

CREATE OR REPLACE FUNCTION public.log_device_token_access()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_service_role boolean;
  v_is_admin boolean;
  v_user_id uuid;
BEGIN
  -- Get current user
  v_user_id := auth.uid();
  
  -- Skip logging for service role (edge functions) - they have legitimate access
  v_is_service_role := (current_setting('request.jwt.claims', true)::jsonb->>'role') = 'service_role';
  IF v_is_service_role THEN
    RETURN NEW;
  END IF;
  
  -- Check if accessing user is admin
  v_is_admin := EXISTS (
    SELECT 1 FROM public.user_roles 
    WHERE user_id = v_user_id 
    AND role = 'admin'
  );
  
  -- Log access if admin is viewing device tokens that aren't their own
  IF v_is_admin AND v_user_id IS DISTINCT FROM NEW.user_id THEN
    INSERT INTO public.admin_audit_logs (
      admin_id,
      action_type,
      target_section,
      target_id,
      details
    ) VALUES (
      v_user_id,
      'VIEW_DEVICE_TOKEN',
      'device_tokens',
      NEW.id::text,
      jsonb_build_object(
        'token_owner_id', NEW.user_id,
        'platform', NEW.platform,
        'accessed_at', now()
      )
    );
  END IF;
  
  RETURN NEW;
END;
$$;

-- Drop trigger if exists and recreate
DROP TRIGGER IF EXISTS audit_device_token_access ON public.device_tokens;

-- Note: SELECT triggers are not supported in PostgreSQL, so we'll implement
-- access control differently - we'll add a function that must be called for bulk access

-- Create a secure function for super admins to access tokens with audit logging
CREATE OR REPLACE FUNCTION public.admin_get_all_device_tokens()
RETURNS TABLE (
  id uuid,
  user_id uuid,
  platform text,
  last_used_at timestamptz,
  created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_is_super_admin boolean;
BEGIN
  v_user_id := auth.uid();
  
  -- Check if user is super admin
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles 
    WHERE user_roles.user_id = v_user_id 
    AND role = 'admin'
    AND admin_role = 'super_admin'
  ) INTO v_is_super_admin;
  
  IF NOT v_is_super_admin THEN
    RAISE EXCEPTION 'Access denied: Super admin role required';
  END IF;
  
  -- Log the bulk access
  INSERT INTO public.admin_audit_logs (
    admin_id,
    action_type,
    target_section,
    target_id,
    details
  ) VALUES (
    v_user_id,
    'BULK_VIEW_DEVICE_TOKENS',
    'device_tokens',
    NULL,
    jsonb_build_object(
      'action', 'bulk_access',
      'accessed_at', now(),
      'reason', 'Admin accessed all device tokens'
    )
  );
  
  -- Return tokens without exposing the actual device_token value
  RETURN QUERY
  SELECT 
    dt.id,
    dt.user_id,
    dt.platform,
    dt.last_used_at,
    dt.created_at
  FROM public.device_tokens dt;
END;
$$;

-- Update RLS to prevent direct bulk SELECT by admins (they must use the function)
-- First drop existing policies
DROP POLICY IF EXISTS "Super admins can view all tokens" ON public.device_tokens;

-- Recreate with more restrictive access
-- Users can only see their own tokens
CREATE POLICY "Users can view own tokens"
ON public.device_tokens
FOR SELECT
USING (auth.uid() = user_id);

-- Users can insert their own tokens
DROP POLICY IF EXISTS "Users can insert own tokens" ON public.device_tokens;
CREATE POLICY "Users can insert own tokens"
ON public.device_tokens
FOR INSERT
WITH CHECK (auth.uid() = user_id);

-- Users can update their own tokens
DROP POLICY IF EXISTS "Users can update own tokens" ON public.device_tokens;
CREATE POLICY "Users can update own tokens"
ON public.device_tokens
FOR UPDATE
USING (auth.uid() = user_id);

-- Users can delete their own tokens
DROP POLICY IF EXISTS "Users can delete own tokens" ON public.device_tokens;
CREATE POLICY "Users can delete own tokens"
ON public.device_tokens
FOR DELETE
USING (auth.uid() = user_id);

-- Service role has full access (for edge functions like send-push-notification)
-- Note: Service role bypasses RLS by default, so no explicit policy needed

COMMENT ON FUNCTION public.admin_get_all_device_tokens() IS 
'Secure function for super admins to access device tokens with audit logging. 
Returns metadata only (no actual token values). All access is logged to admin_audit_logs.';