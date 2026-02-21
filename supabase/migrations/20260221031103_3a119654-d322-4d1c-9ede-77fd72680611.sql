
-- ═══════════════════════════════════════════════════════════
-- PART 1: Add missing columns to catalog_items + backfill
-- ═══════════════════════════════════════════════════════════

-- Add columns if they don't exist
ALTER TABLE public.catalog_items
  ADD COLUMN IF NOT EXISTS currency text DEFAULT 'USD',
  ADD COLUMN IF NOT EXISTS condition text,
  ADD COLUMN IF NOT EXISTS popularity_score numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS price_updated_at timestamptz DEFAULT now(),
  ADD COLUMN IF NOT EXISTS data_updated_at timestamptz DEFAULT now(),
  ADD COLUMN IF NOT EXISTS expires_at timestamptz DEFAULT (now() + interval '30 days'),
  ADD COLUMN IF NOT EXISTS data_hash text,
  ADD COLUMN IF NOT EXISTS is_active boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS last_seen_at timestamptz DEFAULT now();

-- Backfill existing rows
UPDATE public.catalog_items SET
  currency = COALESCE(currency, 'USD'),
  popularity_score = COALESCE(popularity_score, 0),
  price_updated_at = COALESCE(price_updated_at, updated_at),
  data_updated_at = COALESCE(data_updated_at, updated_at),
  expires_at = COALESCE(expires_at, updated_at + interval '30 days'),
  is_active = COALESCE(is_active, true),
  last_seen_at = COALESCE(last_seen_at, updated_at)
WHERE expires_at IS NULL OR is_active IS NULL OR last_seen_at IS NULL;

-- Indexes for TTL/freshness queries
CREATE INDEX IF NOT EXISTS idx_catalog_items_expires_active 
  ON public.catalog_items (expires_at) WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_catalog_items_popularity 
  ON public.catalog_items (unified_category, popularity_score DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS idx_catalog_items_price_updated 
  ON public.catalog_items (price_updated_at);

CREATE INDEX IF NOT EXISTS idx_catalog_items_last_seen 
  ON public.catalog_items (last_seen_at);

CREATE INDEX IF NOT EXISTS idx_catalog_items_is_active
  ON public.catalog_items (is_active) WHERE is_active = true;

-- ═══════════════════════════════════════════════════════════
-- PART 2: Create catalog_refresh_queue
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.catalog_refresh_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_key text NOT NULL,
  provider text NOT NULL,
  query text NOT NULL,
  priority int DEFAULT 100,
  status text DEFAULT 'queued',
  attempts int DEFAULT 0,
  last_error text,
  scheduled_at timestamptz DEFAULT now(),
  locked_at timestamptz,
  locked_by text,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_refresh_queue_status 
  ON public.catalog_refresh_queue (status, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_refresh_queue_priority 
  ON public.catalog_refresh_queue (priority);
CREATE INDEX IF NOT EXISTS idx_refresh_queue_category 
  ON public.catalog_refresh_queue (category_key);

ALTER TABLE public.catalog_refresh_queue ENABLE ROW LEVEL SECURITY;

-- No public access — only service_role
CREATE POLICY "Service role full access on catalog_refresh_queue"
  ON public.catalog_refresh_queue FOR ALL
  USING (false);

-- ═══════════════════════════════════════════════════════════
-- PART 3: Create catalog_category_ttl
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.catalog_category_ttl (
  category_key text PRIMARY KEY,
  max_item_age_days int,
  price_refresh_days int,
  availability_refresh_days int,
  db_min_results int,
  enabled boolean DEFAULT true,
  updated_at timestamptz DEFAULT now(),
  updated_by uuid
);

ALTER TABLE public.catalog_category_ttl ENABLE ROW LEVEL SECURITY;

-- Admin read access
CREATE POLICY "Admins can read catalog_category_ttl"
  ON public.catalog_category_ttl FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = auth.uid() AND role = 'admin'
    )
  );

-- No public write — writes go through edge function with service_role
CREATE POLICY "No public write to catalog_category_ttl"
  ON public.catalog_category_ttl FOR ALL
  USING (false)
  WITH CHECK (false);

-- ═══════════════════════════════════════════════════════════
-- PART 4: Seed global TTL settings into admin_settings
-- ═══════════════════════════════════════════════════════════

INSERT INTO public.admin_settings (key, value, updated_at) VALUES
  ('global_max_item_age_days', '30', now()),
  ('global_price_refresh_days', '3', now()),
  ('global_availability_refresh_days', '3', now()),
  ('db_search_min_results', '5', now())
ON CONFLICT (key) DO NOTHING;
