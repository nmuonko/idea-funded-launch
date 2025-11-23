-- Sync existing admin_users to user_roles
-- First, insert any admin users that don't have an admin role in user_roles
INSERT INTO public.user_roles (user_id, role)
SELECT 
  au.id::uuid as user_id,
  'admin'::app_role as role
FROM auth.users au
INNER JOIN public.admin_users adu ON au.email = adu.email
WHERE NOT EXISTS (
  SELECT 1 
  FROM public.user_roles ur 
  WHERE ur.user_id = au.id::uuid 
  AND ur.role = 'admin'
)
ON CONFLICT (user_id, role) DO NOTHING;

-- Create a function to sync admin_users to user_roles
CREATE OR REPLACE FUNCTION public.sync_admin_user_to_roles()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target_user_id uuid;
BEGIN
  -- Handle INSERT: add admin role to user_roles
  IF TG_OP = 'INSERT' THEN
    -- Find the user_id from auth.users by email
    SELECT id INTO target_user_id
    FROM auth.users
    WHERE email = NEW.email
    LIMIT 1;
    
    IF target_user_id IS NOT NULL THEN
      -- Insert the admin role if it doesn't exist
      INSERT INTO public.user_roles (user_id, role)
      VALUES (target_user_id, 'admin')
      ON CONFLICT (user_id, role) DO NOTHING;
    END IF;
    
    RETURN NEW;
  END IF;
  
  -- Handle DELETE: remove admin role from user_roles
  IF TG_OP = 'DELETE' THEN
    -- Find the user_id from auth.users by email
    SELECT id INTO target_user_id
    FROM auth.users
    WHERE email = OLD.email
    LIMIT 1;
    
    IF target_user_id IS NOT NULL THEN
      -- Delete the admin role
      DELETE FROM public.user_roles
      WHERE user_id = target_user_id
      AND role = 'admin';
    END IF;
    
    RETURN OLD;
  END IF;
  
  RETURN NULL;
END;
$$;

-- Create trigger to automatically sync admin_users to user_roles
DROP TRIGGER IF EXISTS sync_admin_users_trigger ON public.admin_users;
CREATE TRIGGER sync_admin_users_trigger
AFTER INSERT OR DELETE ON public.admin_users
FOR EACH ROW
EXECUTE FUNCTION public.sync_admin_user_to_roles();