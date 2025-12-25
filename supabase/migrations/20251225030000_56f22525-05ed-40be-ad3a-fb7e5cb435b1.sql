-- Drop and recreate the user insert policy to ensure it works correctly
DROP POLICY IF EXISTS "Users can insert messages to their conversations" ON public.support_messages;

-- Create policy allowing users to insert messages into their own conversations
CREATE POLICY "Users can insert messages to their conversations"
ON public.support_messages
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.support_conversations
    WHERE support_conversations.id = support_messages.conversation_id
    AND support_conversations.user_id = auth.uid()
  )
);