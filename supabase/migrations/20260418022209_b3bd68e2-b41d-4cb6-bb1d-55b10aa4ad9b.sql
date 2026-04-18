
-- Drafts created from Telegram forwarded messages
CREATE TABLE public.telegram_import_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Telegram source
  telegram_message_id bigint,
  telegram_chat_id bigint,
  forwarded_from_chat_title text,
  forwarded_from_chat_username text,
  forwarded_from_message_id bigint,
  forwarded_by_user_id bigint,
  forwarded_by_username text,
  -- Content
  caption text,
  image_url text NOT NULL,
  image_storage_path text,
  extra_image_urls jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- Review fields (filled by admin)
  suggested_country text,
  suggested_title text,
  suggested_price_usd numeric(12,2),
  suggested_weight_kg numeric(10,3),
  -- Workflow
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','published','rejected')),
  reviewed_by uuid,
  reviewed_at timestamptz,
  published_product_id uuid REFERENCES public.international_products(id) ON DELETE SET NULL,
  rejection_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_tg_drafts_status_created ON public.telegram_import_drafts(status, created_at DESC);
CREATE UNIQUE INDEX idx_tg_drafts_unique_msg
  ON public.telegram_import_drafts(telegram_chat_id, telegram_message_id)
  WHERE telegram_message_id IS NOT NULL;

ALTER TABLE public.telegram_import_drafts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage telegram drafts"
  ON public.telegram_import_drafts FOR ALL
  TO authenticated
  USING (is_admin(auth.uid()))
  WITH CHECK (is_admin(auth.uid()));

CREATE TRIGGER trg_tg_drafts_updated_at
  BEFORE UPDATE ON public.telegram_import_drafts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Polling state (singleton)
CREATE TABLE public.telegram_import_state (
  id int PRIMARY KEY CHECK (id = 1),
  update_offset bigint NOT NULL DEFAULT 0,
  last_polled_at timestamptz,
  last_error text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.telegram_import_state (id, update_offset) VALUES (1, 0);

ALTER TABLE public.telegram_import_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read telegram state"
  ON public.telegram_import_state FOR SELECT
  TO authenticated
  USING (is_admin(auth.uid()));
