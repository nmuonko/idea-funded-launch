
CREATE TABLE public.checkout_handoff_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token text NOT NULL UNIQUE,
  user_id uuid NOT NULL,
  device_id text,
  purpose text NOT NULL DEFAULT 'checkout_webview_handoff',
  consumed_at timestamptz,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_checkout_handoff_token ON public.checkout_handoff_tokens (token);
CREATE INDEX idx_checkout_handoff_expires ON public.checkout_handoff_tokens (expires_at);

ALTER TABLE public.checkout_handoff_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on checkout_handoff_tokens"
  ON public.checkout_handoff_tokens
  FOR ALL
  USING (true)
  WITH CHECK (true);
