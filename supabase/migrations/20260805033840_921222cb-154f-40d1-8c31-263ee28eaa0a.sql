DROP POLICY IF EXISTS "Anyone can insert their conversation" ON public.chatbot_conversations;

CREATE POLICY "Guests or owners can insert conversations"
ON public.chatbot_conversations
FOR INSERT
TO anon, authenticated
WITH CHECK (user_id IS NULL OR user_id = auth.uid());