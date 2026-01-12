-- Create supported_countries table for admin-configurable service zones
CREATE TABLE public.supported_countries (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  country_code VARCHAR(3) NOT NULL UNIQUE,
  country_name TEXT NOT NULL,
  latitude DECIMAL(10, 6) NOT NULL,
  longitude DECIMAL(10, 6) NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.supported_countries ENABLE ROW LEVEL SECURITY;

-- Public read access for everyone (shown on public map)
CREATE POLICY "Anyone can view active supported countries"
ON public.supported_countries
FOR SELECT
USING (is_active = true);

-- Admin can manage all countries (uses admin_users check)
CREATE POLICY "Admins can manage supported countries"
ON public.supported_countries
FOR ALL
USING (
  EXISTS (SELECT 1 FROM public.admin_users WHERE email = (SELECT email FROM auth.users WHERE id = auth.uid()))
);

-- Insert DRC as initial supported country
INSERT INTO public.supported_countries (country_code, country_name, latitude, longitude, is_active)
VALUES ('COD', 'Democratic Republic of the Congo', -4.0383, 21.7587, true);

-- Create trigger for updated_at
CREATE TRIGGER update_supported_countries_updated_at
BEFORE UPDATE ON public.supported_countries
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();