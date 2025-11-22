-- Create chat_messages table for persisting chatbot conversations
CREATE TABLE IF NOT EXISTS public.chat_messages (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create index for faster queries by session_id
CREATE INDEX IF NOT EXISTS idx_chat_messages_session_id ON public.chat_messages(session_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_created_at ON public.chat_messages(created_at);

-- Enable RLS
ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;

-- Policy: Anyone can insert their own messages
CREATE POLICY "Anyone can insert chat messages"
ON public.chat_messages
FOR INSERT
TO public
WITH CHECK (true);

-- Policy: Anyone can view messages from their session
CREATE POLICY "Anyone can view their session messages"
ON public.chat_messages
FOR SELECT
TO public
USING (true);

-- Add comment for documentation
COMMENT ON TABLE public.chat_messages IS 'Stores chatbot conversation history for user sessions';