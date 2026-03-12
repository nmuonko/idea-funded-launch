
CREATE TABLE IF NOT EXISTS public.support_unanswered_questions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID REFERENCES public.support_conversations(id) ON DELETE CASCADE,
  user_id TEXT,
  question TEXT NOT NULL,
  language TEXT DEFAULT 'fr',
  created_at TIMESTAMPTZ DEFAULT now(),
  resolved BOOLEAN DEFAULT false,
  added_to_faq BOOLEAN DEFAULT false
);

ALTER TABLE public.support_unanswered_questions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can read unanswered questions"
  ON public.support_unanswered_questions
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = auth.uid() AND role = 'admin'
    )
  );
