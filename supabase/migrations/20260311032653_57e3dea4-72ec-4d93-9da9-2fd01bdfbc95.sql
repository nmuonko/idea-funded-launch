SELECT cron.unschedule('shein-scraper-hourly');

SELECT cron.schedule(
  'shein-scraper-10m',
  '*/10 * * * *',
  $$
    SELECT net.http_post(
      url := 'https://igmkhxffnyzoogcqvdab.supabase.co/functions/v1/catalog-shein-scraper',
      headers := '{"Content-Type": "application/json", "x-cron-secret": "afrishop-internal-cron-2026"}'::jsonb,
      body := '{"categories_per_run": 15}'::jsonb
    ) AS request_id;
  $$
);