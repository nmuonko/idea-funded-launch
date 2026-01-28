-- Fix security policies on catalog tables (drop existing first with IF EXISTS)

-- catalog_rate_limits: Remove public access
DROP POLICY IF EXISTS "Service role can manage rate limits" ON public.catalog_rate_limits;
CREATE POLICY "Service role can manage rate limits"
  ON public.catalog_rate_limits FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- catalog_search_cache: Remove public access  
DROP POLICY IF EXISTS "Service role can manage search cache" ON public.catalog_search_cache;
CREATE POLICY "Service role can manage search cache"
  ON public.catalog_search_cache FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- catalog_cache: Remove public access
DROP POLICY IF EXISTS "Service role can manage catalog cache" ON public.catalog_cache;
CREATE POLICY "Service role can manage catalog cache"
  ON public.catalog_cache FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);