
-- 1) chatbot_messages: enforce conversation ownership on insert
DROP POLICY IF EXISTS "Anyone insert message in own conv" ON public.chatbot_messages;
CREATE POLICY "Insert message in own conv"
ON public.chatbot_messages
FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.chatbot_conversations c
    WHERE c.id = chatbot_messages.conversation_id
      AND (
        (auth.uid() IS NOT NULL AND c.user_id = auth.uid())
        OR (auth.uid() IS NULL AND c.user_id IS NULL)
      )
  )
);

-- 2) faq_kb: hide internal routing columns from authenticated users
REVOKE SELECT (trigger_phrases, tags) ON public.faq_kb FROM authenticated;
REVOKE SELECT (trigger_phrases, tags) ON public.faq_kb FROM anon;

-- 3) price_validation_settings: admin-only read
DROP POLICY IF EXISTS price_validation_settings_read ON public.price_validation_settings;
CREATE POLICY price_validation_settings_admin_read
ON public.price_validation_settings
FOR SELECT
USING (has_role(auth.uid(), 'admin'::app_role));

-- 4) referrers: split read vs write; mutations require can_manage_users
DROP POLICY IF EXISTS "Admins with manage permission can modify referrers" ON public.referrers;
CREATE POLICY "Admins with manage permission can insert referrers"
ON public.referrers FOR INSERT
WITH CHECK (is_admin(auth.uid()) AND admin_has_permission(auth.uid(), 'can_manage_users'::text));
CREATE POLICY "Admins with manage permission can update referrers"
ON public.referrers FOR UPDATE
USING (is_admin(auth.uid()) AND admin_has_permission(auth.uid(), 'can_manage_users'::text))
WITH CHECK (is_admin(auth.uid()) AND admin_has_permission(auth.uid(), 'can_manage_users'::text));
CREATE POLICY "Admins with manage permission can delete referrers"
ON public.referrers FOR DELETE
USING (is_admin(auth.uid()) AND admin_has_permission(auth.uid(), 'can_manage_users'::text));
