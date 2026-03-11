-- Clear rate_limited errors on all builder sources so they can retry
UPDATE catalog_builder_state SET last_error = NULL WHERE last_error = 'rate_limited';

-- Update SHEIN scraper cron to run every 5 minutes instead of 10 for faster catalog growth
SELECT cron.unschedule('shein-scraper-10m');

SELECT cron.schedule(
  'shein-scraper-5m',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://igmkhxffnyzoogcqvdab.supabase.co/functions/v1/catalog-shein-scraper',
    headers := '{"Content-Type": "application/json", "x-cron-secret": "afrishop-internal-cron-2026"}'::jsonb,
    body := '{"categories_per_run": 25}'::jsonb
  ) AS request_id;
  $$
);