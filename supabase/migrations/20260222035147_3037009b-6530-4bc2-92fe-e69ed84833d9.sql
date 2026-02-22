CREATE OR REPLACE FUNCTION public._cron_call_refresh_worker(p_mode text, p_body jsonb DEFAULT '{}'::jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_key text;
  v_url text;
  v_headers jsonb;
BEGIN
  -- Try CRON_SECRET from vault first
  BEGIN
    SELECT decrypted_secret INTO v_key
    FROM vault.decrypted_secrets
    WHERE name = 'CRON_SECRET'
    LIMIT 1;
  EXCEPTION WHEN OTHERS THEN
    v_key := NULL;
  END;

  -- Fallback: use service_role key from Supabase settings
  IF v_key IS NULL OR v_key = '' THEN
    v_key := current_setting('pgrst.jwt_secret', true);
  END IF;

  -- Last resort: use the service_role key directly
  IF v_key IS NULL OR v_key = '' THEN
    SELECT decrypted_secret INTO v_key
    FROM vault.decrypted_secrets
    WHERE name = 'supabase_service_role_key'
    LIMIT 1;
  END IF;

  IF v_key IS NULL OR v_key = '' THEN
    RAISE WARNING 'No auth key found for refresh worker';
    RETURN;
  END IF;

  v_url := 'https://wydajcvmdoaqvovncotu.supabase.co/functions/v1/catalog-refresh-worker';
  v_headers := jsonb_build_object(
    'Content-Type', 'application/json',
    'x-cron-secret', v_key
  );

  PERFORM net.http_post(
    url := v_url,
    headers := v_headers,
    body := p_body || jsonb_build_object('mode', p_mode)
  );
END;
$function$;