
CREATE OR REPLACE FUNCTION public.enqueue_all_seeds_ebay(p_limit integer DEFAULT 2000)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_before integer;
  v_after integer;
  v_enqueued integer;
BEGIN
  SELECT COUNT(*) INTO v_before
  FROM public.catalog_refresh_queue
  WHERE status IN ('queued', 'running') AND provider = 'ebay';

  INSERT INTO public.catalog_refresh_queue (category_key, provider, query, priority, status, scheduled_at)
  SELECT 
    sq.category,
    'ebay',
    sq.query,
    9,
    'queued',
    now()
  FROM public.catalog_seed_queries sq
  WHERE sq.enabled = true
    AND length(sq.query) >= 3
  LIMIT p_limit
  ON CONFLICT DO NOTHING;

  GET DIAGNOSTICS v_enqueued = ROW_COUNT;

  SELECT COUNT(*) INTO v_after
  FROM public.catalog_refresh_queue
  WHERE status IN ('queued', 'running') AND provider = 'ebay';

  RETURN jsonb_build_object(
    'enqueued', v_enqueued,
    'total_queued', v_after,
    'run_at', now()
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.enqueue_all_seeds_ebay(integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.enqueue_all_seeds_ebay(integer) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.enqueue_all_seeds_ebay(integer) FROM anon;
