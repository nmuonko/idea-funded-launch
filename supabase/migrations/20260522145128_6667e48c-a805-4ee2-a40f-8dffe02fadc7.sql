
ALTER TABLE public.catalog_items
  ADD COLUMN IF NOT EXISTS refresh_priority_tier text DEFAULT 'normal',
  ADD COLUMN IF NOT EXISTS next_refresh_due_at timestamptz,
  ADD COLUMN IF NOT EXISTS click_count_24h integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cart_count_24h integer DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_catalog_items_refresh_due
  ON public.catalog_items (next_refresh_due_at, refresh_priority_tier)
  WHERE refresh_priority_tier <> 'vehicle';
