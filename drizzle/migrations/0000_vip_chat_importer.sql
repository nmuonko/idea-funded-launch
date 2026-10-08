CREATE TABLE public.vip_import_threads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by uuid,
  title text NOT NULL DEFAULT 'New import',
  state jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.vip_import_threads TO authenticated;
GRANT ALL ON public.vip_import_threads TO service_role;
ALTER TABLE public.vip_import_threads ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage vip import threads" ON public.vip_import_threads FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

CREATE TABLE public.vip_import_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id uuid NOT NULL REFERENCES public.vip_import_threads(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('user','assistant')),
  content text NOT NULL DEFAULT '',
  attachments jsonb NOT NULL DEFAULT '[]'::jsonb,
  blocks jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.vip_import_messages(thread_id, created_at);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.vip_import_messages TO authenticated;
GRANT ALL ON public.vip_import_messages TO service_role;
ALTER TABLE public.vip_import_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage vip import messages" ON public.vip_import_messages FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

ALTER TABLE public.vip_products
  ADD COLUMN IF NOT EXISTS thread_id uuid REFERENCES public.vip_import_threads(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS name_en text,
  ADD COLUMN IF NOT EXISTS description_en text;
CREATE INDEX IF NOT EXISTS vip_products_thread_idx ON public.vip_products(thread_id);

-- Security: catalog_cache is server-only; no public reads.
DROP POLICY IF EXISTS "Anyone can read catalog cache" ON public.catalog_cache;
-- Security: dubai-uploads is private; nothing is served from approved/, admins keep access.
DROP POLICY IF EXISTS "Public read approved dubai uploads" ON storage.objects;