-- Create admin_settings table for storing admin portal settings like theme colors
CREATE TABLE public.admin_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text UNIQUE NOT NULL,
  value text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

-- Enable RLS
ALTER TABLE public.admin_settings ENABLE ROW LEVEL SECURITY;

-- Anyone authenticated can read settings (needed to apply theme)
CREATE POLICY "Authenticated users can view admin settings"
ON public.admin_settings
FOR SELECT
TO authenticated
USING (true);

-- Only super admins can modify settings
CREATE POLICY "Super admins can insert admin settings"
ON public.admin_settings
FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_roles.user_id = auth.uid()
    AND user_roles.role = 'admin'
    AND user_roles.admin_role = 'super_admin'
  )
);

CREATE POLICY "Super admins can update admin settings"
ON public.admin_settings
FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_roles.user_id = auth.uid()
    AND user_roles.role = 'admin'
    AND user_roles.admin_role = 'super_admin'
  )
);

CREATE POLICY "Super admins can delete admin settings"
ON public.admin_settings
FOR DELETE
USING (
  EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_roles.user_id = auth.uid()
    AND user_roles.role = 'admin'
    AND user_roles.admin_role = 'super_admin'
  )
);

-- Create trigger for updated_at
CREATE TRIGGER update_admin_settings_updated_at
BEFORE UPDATE ON public.admin_settings
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Insert default background color
INSERT INTO public.admin_settings (key, value) VALUES ('dashboard_background_color', '#0a0a0a');