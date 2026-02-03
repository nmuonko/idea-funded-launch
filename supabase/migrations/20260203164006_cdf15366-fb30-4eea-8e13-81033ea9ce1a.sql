-- Admin RPC function to clear search caches
-- Only callable by authenticated admin users (role='admin' in user_roles)

CREATE OR REPLACE FUNCTION public.admin_clear_search_cache()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  deleted_catalog integer := 0;
  deleted_proxy integer := 0;
BEGIN
  -- Verify authentication
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  
  -- Verify admin role using user_roles table
  IF NOT EXISTS (
    SELECT 1 FROM public.user_roles 
    WHERE user_id = auth.uid() AND role = 'admin'
  ) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  -- Delete only search-type cache from catalog_cache
  DELETE FROM public.catalog_cache
  WHERE cache_type = 'search';
  GET DIAGNOSTICS deleted_catalog = ROW_COUNT;

  -- Delete all rows from search_proxy_cache (if table exists)
  BEGIN
    EXECUTE 'DELETE FROM public.search_proxy_cache';
    GET DIAGNOSTICS deleted_proxy = ROW_COUNT;
  EXCEPTION WHEN undefined_table THEN
    deleted_proxy := 0;
  END;

  RETURN jsonb_build_object(
    'ok', true,
    'deleted_catalog_cache', deleted_catalog,
    'deleted_search_proxy_cache', deleted_proxy,
    'cleared_at', now()
  );
END;
$$;

-- Revoke public access, only authenticated users can call
REVOKE ALL ON FUNCTION public.admin_clear_search_cache() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_clear_search_cache() TO authenticated;