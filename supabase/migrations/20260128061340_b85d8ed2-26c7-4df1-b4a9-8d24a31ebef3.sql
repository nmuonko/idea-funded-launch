-- Fix security definer view issue - recreate as SECURITY INVOKER
DROP VIEW IF EXISTS public.catalog_providers_public;

CREATE VIEW public.catalog_providers_public 
WITH (security_invoker = true) AS
SELECT 
  id,
  name,
  display_name,
  enabled,
  priority,
  logo_url,
  color_hex,
  capabilities,
  adapter_name,
  environment,
  updated_at
FROM public.catalog_providers;

-- Grant access to view
GRANT SELECT ON public.catalog_providers_public TO anon, authenticated;