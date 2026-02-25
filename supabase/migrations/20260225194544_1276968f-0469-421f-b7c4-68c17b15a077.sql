
-- Re-schedule car scraper cron jobs with realistic max_price
SELECT cron.unschedule('car-scraper-cargurus-daily');
SELECT cron.unschedule('car-scraper-carvana-daily');

SELECT cron.schedule(
  'car-scraper-cargurus-daily',
  '0 4 * * *',
  $$
  SELECT net.http_post(
    url:='https://igmkhxffnyzoogcqvdab.supabase.co/functions/v1/catalog-car-scraper',
    headers:=jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', coalesce((SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'CRON_SECRET' LIMIT 1), 'afrishop-internal-cron-2026')
    ),
    body:='{"provider":"cargurus","max_price":50000,"max_pages":3,"mode":"firecrawl-first","target_items":20}'::jsonb
  ) AS request_id;
  $$
);

SELECT cron.schedule(
  'car-scraper-carvana-daily',
  '2 4 * * *',
  $$
  SELECT net.http_post(
    url:='https://igmkhxffnyzoogcqvdab.supabase.co/functions/v1/catalog-car-scraper',
    headers:=jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', coalesce((SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'CRON_SECRET' LIMIT 1), 'afrishop-internal-cron-2026')
    ),
    body:='{"provider":"carvana","max_price":50000,"max_pages":3,"mode":"firecrawl-first","target_items":20}'::jsonb
  ) AS request_id;
  $$
);
