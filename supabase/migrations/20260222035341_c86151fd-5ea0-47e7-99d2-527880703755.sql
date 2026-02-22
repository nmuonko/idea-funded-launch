CREATE OR REPLACE FUNCTION public._cron_call_refresh_worker(p_mode text, p_body jsonb DEFAULT '{}'::jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_url text;
  v_headers jsonb;
BEGIN
  v_url := 'https://wydajcvmdoaqvovncotu.supabase.co/functions/v1/catalog-refresh-worker';
  v_headers := jsonb_build_object(
    'Content-Type', 'application/json',
    'x-internal-cron-key', 'afrishop-internal-cron-2026'
  );

  PERFORM net.http_post(
    url := v_url,
    headers := v_headers,
    body := p_body || jsonb_build_object('mode', p_mode)
  );
END;
$function$;