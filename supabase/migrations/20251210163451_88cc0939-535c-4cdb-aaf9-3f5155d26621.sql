-- Enable RLS on public_settings view (it's a view, so we need to handle differently)
-- Since public_settings is a VIEW, we need to add RLS to the underlying table (settings)
-- The settings table already has RLS enabled, but public_settings is a view

-- Drop and recreate public_settings as a security definer function for safe public access
DROP VIEW IF EXISTS public_settings;

-- Create a function to get public settings safely
CREATE OR REPLACE FUNCTION public.get_public_exchange_rate()
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT exchange_rate_usd_to_cdf FROM settings LIMIT 1;
$$;

-- Grant execute to anon and authenticated
GRANT EXECUTE ON FUNCTION public.get_public_exchange_rate() TO anon;
GRANT EXECUTE ON FUNCTION public.get_public_exchange_rate() TO authenticated;

-- Recreate public_settings view with proper security
CREATE VIEW public_settings AS
SELECT public.get_public_exchange_rate() as exchange_rate_usd_to_cdf;