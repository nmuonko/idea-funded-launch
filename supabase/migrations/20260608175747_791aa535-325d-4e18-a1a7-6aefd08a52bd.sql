
CREATE TABLE public.chatbot_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  session_id text NOT NULL,
  product_context jsonb,
  status text NOT NULL DEFAULT 'active',
  escalated boolean NOT NULL DEFAULT false,
  escalation_reason text,
  language text NOT NULL DEFAULT 'fr',
  last_message_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_chatbot_conv_user ON public.chatbot_conversations(user_id);
CREATE INDEX idx_chatbot_conv_session ON public.chatbot_conversations(session_id);
CREATE INDEX idx_chatbot_conv_last_msg ON public.chatbot_conversations(last_message_at DESC);

GRANT SELECT, INSERT, UPDATE ON public.chatbot_conversations TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.chatbot_conversations TO anon;
GRANT ALL ON public.chatbot_conversations TO service_role;

ALTER TABLE public.chatbot_conversations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own conversations" ON public.chatbot_conversations
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Admins view all conversations" ON public.chatbot_conversations
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Anyone can insert their conversation" ON public.chatbot_conversations
  FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "Users update own conversations" ON public.chatbot_conversations
  FOR UPDATE TO authenticated USING (auth.uid() = user_id);

CREATE TABLE public.chatbot_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.chatbot_conversations(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('user','assistant','system')),
  content text NOT NULL,
  classification jsonb,
  confidence numeric,
  needs_escalation boolean DEFAULT false,
  escalation_reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_chatbot_msg_conv ON public.chatbot_messages(conversation_id, created_at);

GRANT SELECT, INSERT ON public.chatbot_messages TO authenticated;
GRANT SELECT, INSERT ON public.chatbot_messages TO anon;
GRANT ALL ON public.chatbot_messages TO service_role;

ALTER TABLE public.chatbot_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view messages in own conv" ON public.chatbot_messages
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.chatbot_conversations c WHERE c.id = conversation_id AND c.user_id = auth.uid())
  );
CREATE POLICY "Admins view all messages" ON public.chatbot_messages
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Anyone insert message in own conv" ON public.chatbot_messages
  FOR INSERT TO anon, authenticated WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE TRIGGER trg_chatbot_conv_updated
  BEFORE UPDATE ON public.chatbot_conversations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
