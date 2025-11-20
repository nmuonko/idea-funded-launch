-- Create user roles system for admin authentication
CREATE TYPE public.app_role AS ENUM ('admin', 'user');

-- Create user_roles table
CREATE TABLE public.user_roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    role app_role NOT NULL DEFAULT 'user',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    UNIQUE (user_id, role)
);

-- Enable RLS on user_roles
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- Create security definer function to check roles
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role app_role)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
      AND role = _role
  )
$$;

-- RLS policies for user_roles
CREATE POLICY "Users can view their own roles"
ON public.user_roles
FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Only admins can manage roles"
ON public.user_roles
FOR ALL
USING (public.has_role(auth.uid(), 'admin'));

-- Update admin_users RLS to use new role system
DROP POLICY IF EXISTS "Only admins can view admin users" ON public.admin_users;
DROP POLICY IF EXISTS "Only admins can insert admin users" ON public.admin_users;
DROP POLICY IF EXISTS "Only admins can delete admin users" ON public.admin_users;

CREATE POLICY "Only admins can view admin users"
ON public.admin_users
FOR SELECT
USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Only admins can insert admin users"
ON public.admin_users
FOR INSERT
WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Only admins can delete admin users"
ON public.admin_users
FOR DELETE
USING (public.has_role(auth.uid(), 'admin'));

-- Update other tables to use role-based access
DROP POLICY IF EXISTS "Only admins can insert sessions" ON public.sessions;
DROP POLICY IF EXISTS "Only admins can update sessions" ON public.sessions;

CREATE POLICY "Only admins can insert sessions"
ON public.sessions
FOR INSERT
WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Only admins can update sessions"
ON public.sessions
FOR UPDATE
USING (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Only admins can update submissions" ON public.user_submissions;

CREATE POLICY "Only admins can update submissions"
ON public.user_submissions
FOR UPDATE
USING (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Only admins can view contact messages" ON public.contact_messages;

CREATE POLICY "Only admins can view contact messages"
ON public.contact_messages
FOR SELECT
USING (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Only admins can insert notification logs" ON public.notification_logs;
DROP POLICY IF EXISTS "Only admins can view notification logs" ON public.notification_logs;

CREATE POLICY "Only admins can insert notification logs"
ON public.notification_logs
FOR INSERT
WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Only admins can view notification logs"
ON public.notification_logs
FOR SELECT
USING (public.has_role(auth.uid(), 'admin'));