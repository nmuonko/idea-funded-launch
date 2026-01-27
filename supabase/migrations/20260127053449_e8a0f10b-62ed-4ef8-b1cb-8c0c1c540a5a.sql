-- Fix catalog_products RLS to be more restrictive
-- Drop the overly permissive policy
DROP POLICY IF EXISTS "Service role can manage products" ON public.catalog_products;

-- Only service role can INSERT/UPDATE/DELETE (handled via edge functions)
-- The SELECT policy already exists and is fine for public read access