
-- Seed admin_settings with edge function base URL for both environments
INSERT INTO public.admin_settings (key, value)
VALUES ('edge_function_base_url', 'https://wydajcvmdoaqvovncotu.supabase.co/functions/v1')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();

-- Update _cron_call_refresh_worker to read URL from admin_settings dynamically
CREATE OR REPLACE FUNCTION public._cron_call_refresh_worker(p_mode text, p_body jsonb DEFAULT '{}'::jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_base_url text;
  v_url text;
  v_headers jsonb;
BEGIN
  -- Read the edge function base URL from admin_settings (environment-specific)
  SELECT value INTO v_base_url
  FROM public.admin_settings
  WHERE key = 'edge_function_base_url'
  LIMIT 1;

  -- Fallback to hardcoded Test URL if not configured
  IF v_base_url IS NULL OR v_base_url = '' THEN
    v_base_url := 'https://wydajcvmdoaqvovncotu.supabase.co/functions/v1';
  END IF;

  v_url := v_base_url || '/catalog-refresh-worker';
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
