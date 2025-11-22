-- Create site_content table for CMS
CREATE TABLE IF NOT EXISTS public.site_content (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT UNIQUE NOT NULL,
  value TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.site_content ENABLE ROW LEVEL SECURITY;

-- Allow admins to manage content
CREATE POLICY "Admins can manage site content"
ON public.site_content
FOR ALL
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- Allow anyone to read site content
CREATE POLICY "Anyone can read site content"
ON public.site_content
FOR SELECT
TO public
USING (true);

-- Add trigger for updated_at
CREATE TRIGGER update_site_content_updated_at
BEFORE UPDATE ON public.site_content
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Insert default content values
INSERT INTO public.site_content (key, value, description) VALUES
  ('homepage_hero_title', 'Transform Your Business Idea Into Reality', 'Main title on homepage hero section'),
  ('homepage_hero_subtitle', 'Join our project competition and get funding to launch your entrepreneurial dream in the DRC', 'Subtitle text on homepage hero section'),
  ('faq_enabled', 'true', 'Enable/disable FAQ section'),
  ('contact_email', 'info@projectcompetition.com', 'Contact email address'),
  ('support_whatsapp', '+243 XXX XXX XXX', 'Support WhatsApp number')
ON CONFLICT (key) DO NOTHING;