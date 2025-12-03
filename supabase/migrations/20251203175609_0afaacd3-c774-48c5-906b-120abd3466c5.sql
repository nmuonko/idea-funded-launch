-- Create admin_user_permissions table for granular section access
CREATE TABLE public.admin_user_permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Core sections
  can_view_dashboard boolean NOT NULL DEFAULT true,
  can_view_orders boolean NOT NULL DEFAULT false,
  can_view_active_carts boolean NOT NULL DEFAULT false,
  can_view_saved_carts boolean NOT NULL DEFAULT false,
  -- Experiments & Analytics
  can_view_ab_results boolean NOT NULL DEFAULT false,
  can_view_analytics boolean NOT NULL DEFAULT false,
  -- Payments & Shipping
  can_view_payments boolean NOT NULL DEFAULT false,
  can_view_shipping boolean NOT NULL DEFAULT false,
  can_manage_shipping_types boolean NOT NULL DEFAULT false,
  -- Support & Knowledge
  can_view_tickets boolean NOT NULL DEFAULT false,
  can_view_ticket_analytics boolean NOT NULL DEFAULT false,
  can_view_knowledge_base boolean NOT NULL DEFAULT false,
  -- Admin & Settings
  can_manage_users boolean NOT NULL DEFAULT false,
  can_view_settings boolean NOT NULL DEFAULT false,
  can_view_theme_settings boolean NOT NULL DEFAULT false,
  -- Timestamps
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE(user_id)
);

-- Enable RLS
ALTER TABLE public.admin_user_permissions ENABLE ROW LEVEL SECURITY;

-- Super admins can manage all permissions
CREATE POLICY "Super admins can manage permissions"
ON public.admin_user_permissions
FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_roles.user_id = auth.uid()
    AND user_roles.role = 'admin'
    AND user_roles.admin_role = 'super_admin'
  )
);

-- Admins can view their own permissions
CREATE POLICY "Admins can view own permissions"
ON public.admin_user_permissions
FOR SELECT
USING (user_id = auth.uid());

-- Create trigger for updated_at
CREATE TRIGGER update_admin_user_permissions_updated_at
  BEFORE UPDATE ON public.admin_user_permissions
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at();

-- Migrate existing admin roles to permissions
INSERT INTO public.admin_user_permissions (
  user_id,
  can_view_dashboard,
  can_view_orders,
  can_view_active_carts,
  can_view_saved_carts,
  can_view_ab_results,
  can_view_analytics,
  can_view_payments,
  can_view_shipping,
  can_manage_shipping_types,
  can_view_tickets,
  can_view_ticket_analytics,
  can_view_knowledge_base,
  can_manage_users,
  can_view_settings,
  can_view_theme_settings
)
SELECT 
  ur.user_id,
  true, -- dashboard always true
  CASE WHEN ur.admin_role IN ('super_admin', 'operations') THEN true ELSE false END,
  CASE WHEN ur.admin_role IN ('super_admin', 'operations') THEN true ELSE false END,
  CASE WHEN ur.admin_role IN ('super_admin', 'operations') THEN true ELSE false END,
  CASE WHEN ur.admin_role IN ('super_admin', 'finance') THEN true ELSE false END,
  CASE WHEN ur.admin_role IN ('super_admin', 'finance') THEN true ELSE false END,
  CASE WHEN ur.admin_role IN ('super_admin', 'finance') THEN true ELSE false END,
  CASE WHEN ur.admin_role IN ('super_admin', 'operations') THEN true ELSE false END,
  CASE WHEN ur.admin_role = 'super_admin' THEN true ELSE false END,
  CASE WHEN ur.admin_role IN ('super_admin', 'support') THEN true ELSE false END,
  CASE WHEN ur.admin_role IN ('super_admin', 'support') THEN true ELSE false END,
  CASE WHEN ur.admin_role IN ('super_admin', 'support') THEN true ELSE false END,
  CASE WHEN ur.admin_role = 'super_admin' THEN true ELSE false END,
  CASE WHEN ur.admin_role = 'super_admin' THEN true ELSE false END,
  CASE WHEN ur.admin_role = 'super_admin' THEN true ELSE false END
FROM public.user_roles ur
WHERE ur.role = 'admin'
ON CONFLICT (user_id) DO NOTHING;