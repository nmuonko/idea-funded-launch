-- Fix admin_ai_logs RLS policies to prevent circular dependencies
DROP POLICY IF EXISTS "Only admins can view AI logs" ON public.admin_ai_logs;
DROP POLICY IF EXISTS "Only admins can insert AI logs" ON public.admin_ai_logs;

-- Create new policies with direct user_roles check (no has_role() to prevent recursion)
CREATE POLICY "Only admins can view AI logs"
ON public.admin_ai_logs
FOR SELECT
USING (EXISTS (
  SELECT 1 FROM public.user_roles
  WHERE user_id = auth.uid()
  AND role = 'admin'
));

CREATE POLICY "Only admins can insert AI logs"
ON public.admin_ai_logs
FOR INSERT
WITH CHECK (EXISTS (
  SELECT 1 FROM public.user_roles
  WHERE user_id = auth.uid()
  AND role = 'admin'
));

-- Fix user_submissions RLS policies
DROP POLICY IF EXISTS "Only admins can view all submissions" ON public.user_submissions;

CREATE POLICY "Only admins can view all submissions"
ON public.user_submissions
FOR SELECT
USING (EXISTS (
  SELECT 1 FROM public.user_roles
  WHERE user_id = auth.uid()
  AND role = 'admin'
));

-- Fix site_content RLS policies
DROP POLICY IF EXISTS "Admins can manage site content" ON public.site_content;

-- Create separate policies for each operation
CREATE POLICY "Only admins can insert site content"
ON public.site_content
FOR INSERT
WITH CHECK (EXISTS (
  SELECT 1 FROM public.user_roles
  WHERE user_id = auth.uid()
  AND role = 'admin'
));

CREATE POLICY "Only admins can update site content"
ON public.site_content
FOR UPDATE
USING (EXISTS (
  SELECT 1 FROM public.user_roles
  WHERE user_id = auth.uid()
  AND role = 'admin'
));

CREATE POLICY "Only admins can delete site content"
ON public.site_content
FOR DELETE
USING (EXISTS (
  SELECT 1 FROM public.user_roles
  WHERE user_id = auth.uid()
  AND role = 'admin'
));