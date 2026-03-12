
DROP POLICY IF EXISTS "Admin users can insert chat routing config" ON public.chat_routing_config;
DROP POLICY IF EXISTS "Admin users can view chat routing config" ON public.chat_routing_config;
DROP POLICY IF EXISTS "Admin users can update chat routing config" ON public.chat_routing_config;
DROP POLICY IF EXISTS "Admin users can delete chat routing config" ON public.chat_routing_config;

CREATE POLICY "Admin users can view chat routing config"
  ON public.chat_routing_config FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM admin_users WHERE admin_users.id = auth.uid())
    OR EXISTS (SELECT 1 FROM user_roles WHERE user_roles.user_id = auth.uid() AND user_roles.role = 'admin')
  );

CREATE POLICY "Admin users can insert chat routing config"
  ON public.chat_routing_config FOR INSERT
  WITH CHECK (
    EXISTS (SELECT 1 FROM admin_users WHERE admin_users.id = auth.uid())
    OR EXISTS (SELECT 1 FROM user_roles WHERE user_roles.user_id = auth.uid() AND user_roles.role = 'admin')
  );

CREATE POLICY "Admin users can update chat routing config"
  ON public.chat_routing_config FOR UPDATE
  USING (
    EXISTS (SELECT 1 FROM admin_users WHERE admin_users.id = auth.uid())
    OR EXISTS (SELECT 1 FROM user_roles WHERE user_roles.user_id = auth.uid() AND user_roles.role = 'admin')
  );

CREATE POLICY "Admin users can delete chat routing config"
  ON public.chat_routing_config FOR DELETE
  USING (
    EXISTS (SELECT 1 FROM admin_users WHERE admin_users.id = auth.uid())
    OR EXISTS (SELECT 1 FROM user_roles WHERE user_roles.user_id = auth.uid() AND user_roles.role = 'admin')
  )
