-- Fix: Remove security definer from view by using a simpler approach
-- The function get_public_exchange_rate is security definer (which is fine for functions)
-- But the view shouldn't be security definer

-- Drop the view
DROP VIEW IF EXISTS public_settings;

-- Recreate view without security definer (just a simple select from function)
-- Views calling security definer functions are safe
CREATE OR REPLACE VIEW public_settings 
WITH (security_invoker = true)
AS SELECT public.get_public_exchange_rate() as exchange_rate_usd_to_cdf;