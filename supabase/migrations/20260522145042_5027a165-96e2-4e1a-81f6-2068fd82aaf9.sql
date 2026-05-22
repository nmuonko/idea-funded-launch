
-- 1. order_items: price lock fields
ALTER TABLE public.order_items
  ADD COLUMN IF NOT EXISTS locked_unit_price_usd numeric,
  ADD COLUMN IF NOT EXISTS locked_total_price_usd numeric,
  ADD COLUMN IF NOT EXISTS price_locked_at timestamptz,
  ADD COLUMN IF NOT EXISTS price_lock_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS locked_source_price_usd numeric,
  ADD COLUMN IF NOT EXISTS locked_source_price_checked_at timestamptz,
  ADD COLUMN IF NOT EXISTS price_lock_status text DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS source_marketplace text,
  ADD COLUMN IF NOT EXISTS source_availability text DEFAULT 'unknown';

CREATE INDEX IF NOT EXISTS idx_order_items_lock_expiry
  ON public.order_items (price_lock_expires_at)
  WHERE price_lock_status = 'active';

-- 2. catalog_products: refresh tier tracking
ALTER TABLE public.catalog_products
  ADD COLUMN IF NOT EXISTS refresh_priority_tier text DEFAULT 'normal',
  ADD COLUMN IF NOT EXISTS last_refresh_at timestamptz,
  ADD COLUMN IF NOT EXISTS next_refresh_due_at timestamptz,
  ADD COLUMN IF NOT EXISTS click_count_24h integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cart_count_24h integer DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_catalog_products_refresh_due
  ON public.catalog_products (next_refresh_due_at, refresh_priority_tier)
  WHERE refresh_priority_tier <> 'vehicle';

-- 3. price_validation_settings
CREATE TABLE IF NOT EXISTS public.price_validation_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  electronics_refresh_minutes int NOT NULL DEFAULT 45,
  cart_item_refresh_minutes int NOT NULL DEFAULT 20,
  hot_item_refresh_minutes int NOT NULL DEFAULT 30,
  normal_refresh_minutes int NOT NULL DEFAULT 240,
  cold_refresh_minutes int NOT NULL DEFAULT 1080,
  lock_minutes_electronics int NOT NULL DEFAULT 30,
  lock_minutes_normal int NOT NULL DEFAULT 60,
  allow_checkout_on_verify_fail boolean NOT NULL DEFAULT false,
  max_supplier_delta_pct numeric NOT NULL DEFAULT 25,
  singleton boolean NOT NULL DEFAULT true UNIQUE,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT price_validation_settings_singleton CHECK (singleton = true)
);

INSERT INTO public.price_validation_settings DEFAULT VALUES
ON CONFLICT (singleton) DO NOTHING;

ALTER TABLE public.price_validation_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "price_validation_settings_read" ON public.price_validation_settings;
CREATE POLICY "price_validation_settings_read"
  ON public.price_validation_settings FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "price_validation_settings_admin_write" ON public.price_validation_settings;
CREATE POLICY "price_validation_settings_admin_write"
  ON public.price_validation_settings FOR ALL
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- 4. price_anomalies log
CREATE TABLE IF NOT EXISTS public.price_anomalies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_key text,
  source_url text,
  marketplace text,
  previous_source_price_usd numeric,
  new_source_price_usd numeric,
  delta_pct numeric,
  action_taken text,
  detected_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_price_anomalies_detected
  ON public.price_anomalies (detected_at DESC);

ALTER TABLE public.price_anomalies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "price_anomalies_admin_read" ON public.price_anomalies;
CREATE POLICY "price_anomalies_admin_read"
  ON public.price_anomalies FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'));
