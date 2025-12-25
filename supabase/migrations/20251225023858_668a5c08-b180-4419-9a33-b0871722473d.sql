-- Support Conversations Table
CREATE TABLE public.support_conversations (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'bot' CHECK (status IN ('bot', 'waiting_agent', 'assigned', 'closed')),
  language text NOT NULL DEFAULT 'fr',
  assigned_agent_id uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  last_message_at timestamp with time zone DEFAULT now()
);

-- Support Messages Table
CREATE TABLE public.support_messages (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  conversation_id uuid NOT NULL REFERENCES public.support_conversations(id) ON DELETE CASCADE,
  sender_type text NOT NULL CHECK (sender_type IN ('user', 'bot', 'agent')),
  content text NOT NULL,
  meta jsonb DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Support Agents Table
CREATE TABLE public.support_agents (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL UNIQUE,
  is_online boolean NOT NULL DEFAULT false,
  languages text[] NOT NULL DEFAULT ARRAY['fr']::text[],
  notify_email text,
  notify_push_token text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.support_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_agents ENABLE ROW LEVEL SECURITY;

-- RLS Policies for support_conversations
CREATE POLICY "Users can view their own conversations"
ON public.support_conversations FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own conversations"
ON public.support_conversations FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own conversations"
ON public.support_conversations FOR UPDATE
USING (auth.uid() = user_id);

CREATE POLICY "Admins can view all conversations"
ON public.support_conversations FOR SELECT
USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can update all conversations"
ON public.support_conversations FOR UPDATE
USING (has_role(auth.uid(), 'admin'::app_role));

-- RLS Policies for support_messages
CREATE POLICY "Users can view messages in their conversations"
ON public.support_messages FOR SELECT
USING (EXISTS (
  SELECT 1 FROM public.support_conversations 
  WHERE support_conversations.id = support_messages.conversation_id 
  AND support_conversations.user_id = auth.uid()
));

CREATE POLICY "Users can insert messages to their conversations"
ON public.support_messages FOR INSERT
WITH CHECK (EXISTS (
  SELECT 1 FROM public.support_conversations 
  WHERE support_conversations.id = support_messages.conversation_id 
  AND support_conversations.user_id = auth.uid()
));

CREATE POLICY "Admins can view all messages"
ON public.support_messages FOR SELECT
USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can insert messages"
ON public.support_messages FOR INSERT
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Service role can manage messages"
ON public.support_messages FOR ALL
USING (true);

-- RLS Policies for support_agents
CREATE POLICY "Admins can manage agents"
ON public.support_agents FOR ALL
USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Agents can update their own status"
ON public.support_agents FOR UPDATE
USING (auth.uid() = user_id);

CREATE POLICY "Agents can view their own record"
ON public.support_agents FOR SELECT
USING (auth.uid() = user_id);

-- Enable Realtime for support_messages
ALTER PUBLICATION supabase_realtime ADD TABLE public.support_messages;

-- Create indexes
CREATE INDEX idx_support_conversations_user_id ON public.support_conversations(user_id);
CREATE INDEX idx_support_conversations_status ON public.support_conversations(status);
CREATE INDEX idx_support_messages_conversation_id ON public.support_messages(conversation_id);
CREATE INDEX idx_support_messages_created_at ON public.support_messages(created_at);

-- Update trigger for updated_at
CREATE TRIGGER update_support_conversations_updated_at
BEFORE UPDATE ON public.support_conversations
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE TRIGGER update_support_agents_updated_at
BEFORE UPDATE ON public.support_agents
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();