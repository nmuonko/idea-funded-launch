INSERT INTO storage.buckets (id, name, public)
VALUES ('email-assets', 'email-assets', true)
ON CONFLICT (id) DO NOTHING;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Public read access on email-assets' AND tablename = 'objects') THEN
    CREATE POLICY "Public read access on email-assets"
    ON storage.objects FOR SELECT
    TO public
    USING (bucket_id = 'email-assets');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Service role insert on email-assets' AND tablename = 'objects') THEN
    CREATE POLICY "Service role insert on email-assets"
    ON storage.objects FOR INSERT
    TO service_role
    WITH CHECK (bucket_id = 'email-assets');
  END IF;
END $$;