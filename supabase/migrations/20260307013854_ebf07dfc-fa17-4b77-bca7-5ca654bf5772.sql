-- Create email-assets storage bucket for logo
INSERT INTO storage.buckets (id, name, public) VALUES ('email-assets', 'email-assets', true)
ON CONFLICT (id) DO NOTHING;

-- Allow public read access
CREATE POLICY "Email assets are publicly accessible" ON storage.objects FOR SELECT USING (bucket_id = 'email-assets');