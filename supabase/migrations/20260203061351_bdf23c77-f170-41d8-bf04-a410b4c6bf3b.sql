-- Add proxy cache TTL settings to existing admin_settings table
INSERT INTO public.admin_settings (key, value) VALUES
  ('proxy_search_cache_ttl_seconds', '900'),
  ('proxy_item_cache_ttl_seconds', '300'),
  ('proxy_stale_max_seconds', '21600')
ON CONFLICT (key) DO NOTHING;