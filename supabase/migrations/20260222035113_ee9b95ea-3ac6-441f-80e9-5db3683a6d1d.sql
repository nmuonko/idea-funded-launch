CREATE OR REPLACE FUNCTION public._cron_call_refresh_worker(p_mode text, p_body jsonb DEFAULT '{}'::jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_service_key text;
  v_url text;
  v_headers jsonb;
BEGIN
  -- Use service_role key from Supabase settings (always in sync)
  v_service_key := current_setting('supabase.service_role_key', true);

  -- Fallback to CRON_SECRET from vault
  IF v_service_key IS NULL OR v_service_key = '' THEN
    SELECT decrypted_secret INTO v_service_key
    FROM vault.decrypted_secrets
    WHERE name = 'CRON_SECRET'
    LIMIT 1;
  END IF;

  IF v_service_key IS NULL THEN
    RAISE WARNING 'No auth key found for refresh worker';
    RETURN;
  END IF;

  v_url := 'https://wydajcvmdoaqvovncotu.supabase.co/functions/v1/catalog-refresh-worker';
  v_headers := jsonb_build_object(
    'Content-Type', 'application/json',
    'Authorization', 'Bearer ' || v_service_key
  );

  PERFORM net.http_post(
    url := v_url,
    headers := v_headers,
    body := p_body || jsonb_build_object('mode', p_mode)
  );
END;
$function$;