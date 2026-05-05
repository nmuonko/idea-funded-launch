-- Ad reels feature
CREATE TABLE public.ad_reels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  caption text,
  video_url text NOT NULL,
  poster_url text,
  cta_label text,
  cta_url text,
  product_provider text,
  product_id text,
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  views_count integer NOT NULL DEFAULT 0,
  clicks_count integer NOT NULL DEFAULT 0,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_ad_reels_active_order ON public.ad_reels(is_active, sort_order) WHERE is_active = true;

ALTER TABLE public.ad_reels ENABLE ROW LEVEL SECURITY;

-- Public can read active reels
CREATE POLICY "Anyone can view active reels"
ON public.ad_reels FOR SELECT
USING (is_active = true);

-- Admins full access (uses existing has_role helper if present)
CREATE POLICY "Admins manage reels select"
ON public.ad_reels FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins insert reels"
ON public.ad_reels FOR INSERT
TO authenticated
WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins update reels"
ON public.ad_reels FOR UPDATE
TO authenticated
USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins delete reels"
ON public.ad_reels FOR DELETE
TO authenticated
USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER trg_ad_reels_updated_at
BEFORE UPDATE ON public.ad_reels
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Storage bucket for reel videos & posters
INSERT INTO storage.buckets (id, name, public)
VALUES ('reels', 'reels', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Public read reels media"
ON storage.objects FOR SELECT
USING (bucket_id = 'reels');

CREATE POLICY "Admins upload reels media"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'reels' AND public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins update reels media"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'reels' AND public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins delete reels media"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'reels' AND public.has_role(auth.uid(), 'admin'::app_role));