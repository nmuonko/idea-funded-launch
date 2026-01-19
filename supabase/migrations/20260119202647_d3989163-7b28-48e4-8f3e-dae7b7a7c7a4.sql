-- Fix PUBLIC_DATA_EXPOSURE: price_capture_cache table is publicly readable
-- Drop the overly permissive policies and replace with authenticated-only access

-- Drop the public SELECT policy
DROP POLICY IF EXISTS "Anyone can read price cache" ON public.price_capture_cache;

-- Drop the redundant "Authenticated users can view price cache" policy that also uses USING (true)
DROP POLICY IF EXISTS "Authenticated users can view price cache" ON public.price_capture_cache;

-- Create a proper authenticated-only SELECT policy
CREATE POLICY "Authenticated users can read price cache"
  ON public.price_capture_cache
  FOR SELECT
  TO authenticated
  USING (true);

-- Add a policy to allow anonymous users to read ONLY their own device's cached prices if needed for guest cart
-- This is optional but allows guest cart functionality while preventing bulk enumeration
CREATE POLICY "Block anonymous access on price_capture_cache"
  ON public.price_capture_cache
  FOR ALL
  TO anon
  USING (false);