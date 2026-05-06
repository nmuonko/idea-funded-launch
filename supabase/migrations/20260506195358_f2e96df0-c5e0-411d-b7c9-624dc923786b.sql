
-- Price drift tracking on catalog_items
ALTER TABLE public.catalog_items
  ADD COLUMN IF NOT EXISTS needs_price_review boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS last_price_check_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_known_live_price_usd numeric,
  ADD COLUMN IF NOT EXISTS price_drift_pct numeric,
  ADD COLUMN IF NOT EXISTS price_check_status text,
  ADD COLUMN IF NOT EXISTS price_check_error text;

CREATE INDEX IF NOT EXISTS idx_catalog_items_needs_review
  ON public.catalog_items(needs_price_review) WHERE needs_price_review = true;

CREATE INDEX IF NOT EXISTS idx_catalog_items_last_price_check
  ON public.catalog_items(last_price_check_at NULLS FIRST)
  WHERE is_active = true AND (is_disallowed IS NULL OR is_disallowed = false);

-- Audit log for price changes by the checker
CREATE TABLE IF NOT EXISTS public.price_check_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  catalog_item_id text NOT NULL,
  provider text,
  provider_product_id text,
  old_price_usd numeric,
  new_price_usd numeric,
  drift_pct numeric,
  action text NOT NULL, -- 'auto_updated' | 'flagged' | 'no_change' | 'extract_failed'
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_price_check_log_item ON public.price_check_log(catalog_item_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_price_check_log_action ON public.price_check_log(action, created_at DESC);

ALTER TABLE public.price_check_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admins read price_check_log" ON public.price_check_log;
CREATE POLICY "admins read price_check_log" ON public.price_check_log
  FOR SELECT TO authenticated
  USING (public.is_admin(auth.uid()));
