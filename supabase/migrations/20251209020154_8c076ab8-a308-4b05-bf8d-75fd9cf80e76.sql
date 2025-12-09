
-- Fix SECURITY DEFINER view issue by using SECURITY INVOKER
DROP VIEW IF EXISTS public.public_settings;

CREATE OR REPLACE VIEW public.public_settings 
WITH (security_invoker = true)
AS
SELECT 
  exchange_rate_usd_to_cdf
FROM public.settings
LIMIT 1;

-- Grant access to the safe view
GRANT SELECT ON public.public_settings TO authenticated;
