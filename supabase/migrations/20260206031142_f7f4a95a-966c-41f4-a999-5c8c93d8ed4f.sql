-- Add new admin_settings keys for 1000-item pool with curated segments
INSERT INTO public.admin_settings (key, value)
VALUES 
  ('home_feed_pool_size', '1000'),
  ('home_feed_page_size', '60')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();

-- Update existing keys to new defaults
UPDATE public.admin_settings SET value = '1000', updated_at = now() WHERE key = 'home_feed_limit';
UPDATE public.admin_settings SET value = '172800', updated_at = now() WHERE key = 'home_feed_ttl_seconds';