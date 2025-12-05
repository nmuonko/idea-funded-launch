-- Add can_view_customers permission to admin_user_permissions table
ALTER TABLE public.admin_user_permissions
ADD COLUMN IF NOT EXISTS can_view_customers boolean NOT NULL DEFAULT false;

-- Update existing super_admin users to have customer view permission
UPDATE public.admin_user_permissions aup
SET can_view_customers = true
WHERE EXISTS (
  SELECT 1 FROM public.user_roles ur
  WHERE ur.user_id = aup.user_id
  AND ur.admin_role = 'super_admin'
);