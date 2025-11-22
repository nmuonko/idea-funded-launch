-- Create winners table for showcasing winners
CREATE TABLE IF NOT EXISTS public.winners (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id UUID REFERENCES public.sessions(id) ON DELETE SET NULL,
  winner_name TEXT NOT NULL,
  project_name TEXT NOT NULL,
  country TEXT NOT NULL,
  award_amount NUMERIC NOT NULL,
  year INTEGER NOT NULL,
  testimonial_text TEXT,
  short_quote TEXT,
  image_url TEXT,
  display_order INTEGER NOT NULL DEFAULT 0,
  is_published BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create feature_flags table for app configuration
CREATE TABLE IF NOT EXISTS public.feature_flags (
  key TEXT NOT NULL PRIMARY KEY,
  value JSONB NOT NULL DEFAULT 'false'::jsonb,
  description TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create theme_settings table for UI customization
CREATE TABLE IF NOT EXISTS public.theme_settings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  primary_color TEXT NOT NULL DEFAULT '#0F172A',
  secondary_color TEXT NOT NULL DEFAULT '#6366F1',
  accent_color TEXT NOT NULL DEFAULT '#FACC15',
  hero_background_style TEXT NOT NULL DEFAULT 'gradient',
  button_style TEXT,
  typography_preset TEXT NOT NULL DEFAULT 'modern',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create admin_ai_logs table for tracking AI Command Center actions
CREATE TABLE IF NOT EXISTS public.admin_ai_logs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  admin_email TEXT NOT NULL,
  timestamp TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  action_description TEXT NOT NULL,
  details_json JSONB,
  success BOOLEAN NOT NULL DEFAULT true,
  error_message TEXT
);

-- Enable RLS on all new tables
ALTER TABLE public.winners ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feature_flags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.theme_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_ai_logs ENABLE ROW LEVEL SECURITY;

-- RLS policies for winners (public read, admin write)
CREATE POLICY "Anyone can view published winners"
ON public.winners FOR SELECT
USING (is_published = true);

CREATE POLICY "Only admins can manage winners"
ON public.winners FOR ALL
USING (has_role(auth.uid(), 'admin'::app_role));

-- RLS policies for feature_flags (public read, admin write)
CREATE POLICY "Anyone can view feature flags"
ON public.feature_flags FOR SELECT
USING (true);

CREATE POLICY "Only admins can manage feature flags"
ON public.feature_flags FOR INSERT
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Only admins can update feature flags"
ON public.feature_flags FOR UPDATE
USING (has_role(auth.uid(), 'admin'::app_role));

-- RLS policies for theme_settings (public read, admin write)
CREATE POLICY "Anyone can view theme settings"
ON public.theme_settings FOR SELECT
USING (true);

CREATE POLICY "Only admins can manage theme settings"
ON public.theme_settings FOR ALL
USING (has_role(auth.uid(), 'admin'::app_role));

-- RLS policies for admin_ai_logs (admin only)
CREATE POLICY "Only admins can view AI logs"
ON public.admin_ai_logs FOR SELECT
USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Only admins can insert AI logs"
ON public.admin_ai_logs FOR INSERT
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- Insert default feature flags
INSERT INTO public.feature_flags (key, value, description) VALUES
  ('enable_voice_submission', 'true'::jsonb, 'Enable or disable voice-based submissions'),
  ('show_public_results', 'true'::jsonb, 'Show or hide the public results page')
ON CONFLICT (key) DO NOTHING;

-- Insert default theme settings (single row)
INSERT INTO public.theme_settings (primary_color, secondary_color, accent_color)
VALUES ('#0F172A', '#6366F1', '#FACC15')
ON CONFLICT DO NOTHING;

-- Create trigger for updating updated_at on winners
CREATE TRIGGER update_winners_updated_at
BEFORE UPDATE ON public.winners
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Create trigger for updating updated_at on feature_flags
CREATE TRIGGER update_feature_flags_updated_at
BEFORE UPDATE ON public.feature_flags
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Create trigger for updating updated_at on theme_settings
CREATE TRIGGER update_theme_settings_updated_at
BEFORE UPDATE ON public.theme_settings
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();