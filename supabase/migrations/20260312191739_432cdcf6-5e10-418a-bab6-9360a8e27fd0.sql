
DROP POLICY IF EXISTS "Users can view own roles or admins can view all" ON public.user_roles;

CREATE OR REPLACE FUNCTION public.is_admin(check_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = check_user_id AND role = 'admin'
  )
$$;

CREATE POLICY "Users can view own roles or admins can view all"
  ON public.user_roles FOR SELECT
  USING (
    auth.uid() = user_id
    OR public.is_admin(auth.uid())
  )
