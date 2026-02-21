
-- Add missing columns to catalog_items for never-delete + deactivation logic
ALTER TABLE public.catalog_items 
  ADD COLUMN IF NOT EXISTS status_reason text DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS fail_count integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_checked_at timestamptz NULL;

-- Backfill existing rows
UPDATE public.catalog_items 
SET status_reason = CASE WHEN is_active = true THEN 'active' ELSE 'deactivated' END,
    fail_count = 0,
    last_checked_at = COALESCE(data_updated_at, updated_at, now())
WHERE status_reason IS NULL OR fail_count IS NULL;

-- Index for refresh worker: find items due for price refresh
CREATE INDEX IF NOT EXISTS idx_catalog_items_price_refresh 
  ON public.catalog_items (price_updated_at ASC) 
  WHERE is_active = true;

-- Index for deactivation checks
CREATE INDEX IF NOT EXISTS idx_catalog_items_last_seen 
  ON public.catalog_items (last_seen_at ASC) 
  WHERE is_active = true;

-- Index for fail_count deactivation
CREATE INDEX IF NOT EXISTS idx_catalog_items_fail_count 
  ON public.catalog_items (fail_count DESC) 
  WHERE is_active = true AND fail_count > 0;
