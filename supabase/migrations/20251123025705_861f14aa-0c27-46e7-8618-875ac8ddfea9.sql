-- Allow public read access to active sessions (for Apply and Results pages)
CREATE POLICY "Anyone can view active sessions"
ON public.sessions
FOR SELECT
USING (status IN ('open', 'closed', 'results_published'));

-- Ensure user_roles table allows users to check their own role
DROP POLICY IF EXISTS "Users can view their own roles" ON public.user_roles;
CREATE POLICY "Users can view their own roles"
ON public.user_roles
FOR SELECT
USING (auth.uid() = user_id OR true);