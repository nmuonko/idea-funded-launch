-- Add heartbeat columns to auto_seed_promotions
ALTER TABLE public.auto_seed_promotions
  ADD COLUMN IF NOT EXISTS last_refreshed_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_refresh_count integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_refresh_status text;
