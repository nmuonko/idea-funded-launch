-- Fix 1: price_history - Require authentication for reading price history
DROP POLICY IF EXISTS "Anyone can read price history" ON public.price_history;
DROP POLICY IF EXISTS "Public read price history" ON public.price_history;

CREATE POLICY "Authenticated users can read price history"
  ON public.price_history FOR SELECT
  TO authenticated
  USING (true);

-- Fix 2: catalog_providers - Restrict access to sensitive columns
-- Drop existing permissive policy
DROP POLICY IF EXISTS "Authenticated users can read enabled providers" ON public.catalog_providers;
DROP POLICY IF EXISTS "Anyone can read enabled providers" ON public.catalog_providers;

-- Create restrictive policy - only allow reading safe columns via a view
-- First, create the public-safe view
CREATE OR REPLACE VIEW public.catalog_providers_public
WITH (security_invoker = on)
AS SELECT 
  id,
  name,
  display_name,
  enabled,
  priority,
  logo_url,
  color_hex,
  capabilities
FROM public.catalog_providers
WHERE enabled = true;

-- Grant select on the view to authenticated and anon roles
GRANT SELECT ON public.catalog_providers_public TO authenticated, anon;

-- Now restrict direct table access - only admins can access full table
CREATE POLICY "Admins can manage all provider data"
  ON public.catalog_providers FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));