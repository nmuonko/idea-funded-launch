CREATE OR REPLACE FUNCTION public.clear_search_cache_by_pattern(pattern text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  deleted_count integer;
BEGIN
  DELETE FROM catalog_cache 
  WHERE query ILIKE pattern
     OR cache_key ILIKE pattern;
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;