-- ============================================================================
-- SECURITY FIX: Restrict public data exposure on catalog tables
-- 
-- catalog_items, catalog_search_cache, app_runtime_config were publicly readable.
-- Edge functions use service_role which bypasses RLS, so this change doesn't
-- break the app - only prevents direct anonymous client access to these tables.
-- ============================================================================

-- 1. catalog_items: Remove public read, require authentication
DROP POLICY IF EXISTS "Anyone can read catalog items" ON public.catalog_items;

CREATE POLICY "Authenticated users can read catalog items"
ON public.catalog_items
FOR SELECT
TO authenticated
USING (true);

-- 2. catalog_search_cache: Fix the policy to actually require authentication  
DROP POLICY IF EXISTS "Authenticated users can read search cache" ON public.catalog_search_cache;

CREATE POLICY "Authenticated users can read search cache"
ON public.catalog_search_cache
FOR SELECT
TO authenticated
USING (true);

-- 3. app_runtime_config: Remove public read, require authentication
DROP POLICY IF EXISTS "Anyone can read runtime config" ON public.app_runtime_config;

CREATE POLICY "Authenticated users can read runtime config"
ON public.app_runtime_config
FOR SELECT
TO authenticated
USING (true);