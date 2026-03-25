-- Pause non-essential cron jobs to reduce compute costs
SELECT cron.unschedule('catalog-builder-campaign');
SELECT cron.unschedule('saved-cart-reminders-daily');
SELECT cron.unschedule('send-abandoned-cart-recovery-daily');
SELECT cron.unschedule('shein-scraper-5m');
SELECT cron.unschedule('car-scraper-cargurus-15m');
SELECT cron.unschedule('car-scraper-carvana-15m');
SELECT cron.unschedule('catalog-prewarm-home-12h');
SELECT cron.unschedule('promote-popular-searches-6h');
SELECT cron.unschedule('amazon-ingest-worker-30m');
SELECT cron.unschedule('bulk-sync-resync');
SELECT cron.unschedule('bulk-sync-runner-1m');
SELECT cron.unschedule('incremental-sync-30m');
SELECT cron.unschedule('aggregate-popularity-daily');