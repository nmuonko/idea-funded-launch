-- Add is_active field to sessions table to mark the current active session
ALTER TABLE public.sessions 
ADD COLUMN IF NOT EXISTS is_active boolean DEFAULT false;

-- Ensure only one session can be active at a time
CREATE OR REPLACE FUNCTION public.ensure_single_active_session()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.is_active = true THEN
    UPDATE public.sessions 
    SET is_active = false 
    WHERE id != NEW.id AND is_active = true;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS ensure_single_active_session_trigger ON public.sessions;
CREATE TRIGGER ensure_single_active_session_trigger
  BEFORE INSERT OR UPDATE ON public.sessions
  FOR EACH ROW
  EXECUTE FUNCTION public.ensure_single_active_session();

-- Ensure site_content table has necessary keys for CMS
INSERT INTO public.site_content (key, value, description) VALUES
  ('homepage_hero_title', 'AfriFund: Empowering African Entrepreneurs', 'Main title on homepage hero section'),
  ('homepage_hero_subtitle', 'Get funding for your innovative business ideas across Africa', 'Subtitle on homepage hero section'),
  ('how_it_works_intro', 'Our simple 3-step process helps you apply for funding', 'Intro text for How It Works page'),
  ('results_page_intro', 'Track your application status and see competition progress', 'Intro text for Results page'),
  ('footer_text', '© 2025 AfriFund. All rights reserved.', 'Footer copyright text')
ON CONFLICT (key) DO NOTHING;

-- Create helper function to get active session
CREATE OR REPLACE FUNCTION public.get_active_session()
RETURNS TABLE(
  id uuid,
  name text,
  start_date timestamp with time zone,
  deadline_datetime timestamp with time zone,
  target_applicants integer,
  current_participant_count integer,
  status text,
  is_active boolean
) 
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT 
    id,
    name,
    start_date,
    deadline_datetime,
    target_applicants,
    current_participant_count,
    status::text,
    is_active
  FROM public.sessions
  WHERE is_active = true
  LIMIT 1;
$$
LANGUAGE sql;