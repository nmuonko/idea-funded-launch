-- Fix user_roles RLS policies to prevent circular dependencies
DROP POLICY IF EXISTS "Only admins can manage roles" ON public.user_roles;
DROP POLICY IF EXISTS "Users can view their own roles" ON public.user_roles;

-- Allow users to view their own roles (no has_role call to prevent recursion)
CREATE POLICY "Users can view their own roles"
ON public.user_roles
FOR SELECT
USING (auth.uid() = user_id);

-- Admin-only policies for INSERT/UPDATE/DELETE (safe because they don't affect SELECT)
CREATE POLICY "Only admins can insert roles"
ON public.user_roles
FOR INSERT
WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Only admins can update roles"
ON public.user_roles
FOR UPDATE
USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Only admins can delete roles"
ON public.user_roles
FOR DELETE
USING (public.has_role(auth.uid(), 'admin'::app_role));

-- Fix sessions RLS policies - remove redundant admin-only SELECT policy
DROP POLICY IF EXISTS "Only admins can view sessions" ON public.sessions;

-- Keep the public access policy for active sessions (already exists from previous migration)
-- Keep the INSERT/UPDATE admin policies (they're safe because they're not SELECT)