
-- Dubai uploads table
CREATE TABLE IF NOT EXISTS public.dubai_uploads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  source text NOT NULL DEFAULT 'dubai',
  category text NOT NULL,
  model text,
  model_other_text text,
  refined_title text,
  storage text,
  color text,
  condition text,
  battery_health int,
  sim_type text,
  network_status text,
  face_id text,
  dubai_price_aed numeric,
  dubai_price_usd numeric,
  final_price_usd numeric,
  images text[] NOT NULL DEFAULT '{}',
  raw_images text[] NOT NULL DEFAULT '{}',
  video_url text,
  supplier_notes text,
  public_description text,
  admin_notes text,
  status text NOT NULL DEFAULT 'pending_review',
  published_showcase_id uuid REFERENCES public.hot_products_showcase(id) ON DELETE SET NULL,
  submitted_by_token_hash text,
  CONSTRAINT dubai_uploads_status_chk CHECK (status IN ('pending_review','approved','rejected'))
);

CREATE INDEX IF NOT EXISTS dubai_uploads_status_idx ON public.dubai_uploads(status, created_at DESC);

ALTER TABLE public.dubai_uploads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins view dubai uploads"
  ON public.dubai_uploads FOR SELECT TO authenticated
  USING (public.is_admin(auth.uid()));

CREATE POLICY "Admins update dubai uploads"
  ON public.dubai_uploads FOR UPDATE TO authenticated
  USING (public.is_admin(auth.uid()));

CREATE POLICY "Admins delete dubai uploads"
  ON public.dubai_uploads FOR DELETE TO authenticated
  USING (public.is_admin(auth.uid()));

-- No INSERT policy: inserts happen only via service_role in the edge function.

CREATE TRIGGER dubai_uploads_set_updated_at
  BEFORE UPDATE ON public.dubai_uploads
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Generic admin secrets table (used for Dubai upload token + pricing rules)
CREATE TABLE IF NOT EXISTS public.app_secrets (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.app_secrets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read app secrets"
  ON public.app_secrets FOR SELECT TO authenticated
  USING (public.is_admin(auth.uid()));

CREATE POLICY "Admins write app secrets"
  ON public.app_secrets FOR INSERT TO authenticated
  WITH CHECK (public.is_admin(auth.uid()));

CREATE POLICY "Admins update app secrets"
  ON public.app_secrets FOR UPDATE TO authenticated
  USING (public.is_admin(auth.uid()));

CREATE POLICY "Admins delete app secrets"
  ON public.app_secrets FOR DELETE TO authenticated
  USING (public.is_admin(auth.uid()));

-- Storage bucket for Dubai photos (public read so showcase images load)
INSERT INTO storage.buckets (id, name, public)
VALUES ('dubai-uploads', 'dubai-uploads', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Public read dubai uploads bucket"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'dubai-uploads');

CREATE POLICY "Admins manage dubai uploads bucket"
  ON storage.objects FOR ALL TO authenticated
  USING (bucket_id = 'dubai-uploads' AND public.is_admin(auth.uid()))
  WITH CHECK (bucket_id = 'dubai-uploads' AND public.is_admin(auth.uid()));
