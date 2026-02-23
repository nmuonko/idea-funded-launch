
-- =============================================
-- Catalog Builder System: Tables + Functions
-- =============================================

-- 1) catalog_builder_sources
CREATE TABLE public.catalog_builder_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_key text NOT NULL,
  provider text NOT NULL CHECK (provider IN ('ebay', 'rainforest')),
  source_type text NOT NULL CHECK (source_type IN ('seed_query', 'ebay_category')),
  source_value text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  priority int NOT NULL DEFAULT 10,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.catalog_builder_sources ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin read catalog_builder_sources"
  ON public.catalog_builder_sources FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admin insert catalog_builder_sources"
  ON public.catalog_builder_sources FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admin update catalog_builder_sources"
  ON public.catalog_builder_sources FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admin delete catalog_builder_sources"
  ON public.catalog_builder_sources FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- 2) catalog_builder_state
CREATE TABLE public.catalog_builder_state (
  source_id uuid PRIMARY KEY REFERENCES public.catalog_builder_sources(id) ON DELETE CASCADE,
  current_offset int NOT NULL DEFAULT 0,
  total_ingested int NOT NULL DEFAULT 0,
  exhausted boolean NOT NULL DEFAULT false,
  last_run_at timestamptz,
  last_error text
);

ALTER TABLE public.catalog_builder_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin read catalog_builder_state"
  ON public.catalog_builder_state FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admin manage catalog_builder_state"
  ON public.catalog_builder_state FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- 3) catalog_builder_goals
CREATE TABLE public.catalog_builder_goals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  status text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'completed', 'canceled')),
  start_at timestamptz NOT NULL DEFAULT now(),
  end_at timestamptz NOT NULL,
  goal_total int NOT NULL DEFAULT 10000,
  goal_ebay int NOT NULL DEFAULT 5000,
  goal_rainforest int NOT NULL DEFAULT 5000,
  achieved_total int NOT NULL DEFAULT 0,
  achieved_ebay int NOT NULL DEFAULT 0,
  achieved_rainforest int NOT NULL DEFAULT 0,
  continuous boolean NOT NULL DEFAULT true,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_run_at timestamptz,
  last_error text
);

ALTER TABLE public.catalog_builder_goals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin read catalog_builder_goals"
  ON public.catalog_builder_goals FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admin manage catalog_builder_goals"
  ON public.catalog_builder_goals FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- 4) catalog_builder_runs
CREATE TABLE public.catalog_builder_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  goal_id uuid REFERENCES public.catalog_builder_goals(id) ON DELETE SET NULL,
  provider text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  items_upserted int NOT NULL DEFAULT 0,
  new_unique_items int NOT NULL DEFAULT 0,
  duplicates_skipped int NOT NULL DEFAULT 0,
  rate_limited_count int NOT NULL DEFAULT 0,
  duration_ms int NOT NULL DEFAULT 0,
  sources_processed int NOT NULL DEFAULT 0
);

ALTER TABLE public.catalog_builder_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin read catalog_builder_runs"
  ON public.catalog_builder_runs FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admin insert catalog_builder_runs"
  ON public.catalog_builder_runs FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- 5) provider_health_status
CREATE TABLE public.provider_health_status (
  provider text PRIMARY KEY,
  healthy boolean NOT NULL DEFAULT true,
  reason text,
  unhealthy_until timestamptz,
  consecutive_failures int NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.provider_health_status ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin read provider_health_status"
  ON public.provider_health_status FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- Seed initial provider rows
INSERT INTO public.provider_health_status (provider, healthy) VALUES ('ebay', true), ('rainforest', true);

-- 6) product_popularity_events
CREATE TABLE public.product_popularity_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id text NOT NULL,
  delta int NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_popularity_events_created ON public.product_popularity_events (created_at);

ALTER TABLE public.product_popularity_events ENABLE ROW LEVEL SECURITY;
-- No authenticated policies - only service_role writes/reads

-- 7) Add first_seen_at to catalog_items
ALTER TABLE public.catalog_items ADD COLUMN IF NOT EXISTS first_seen_at timestamptz DEFAULT now();

-- 8) Aggregate popularity scores function (nightly cron)
CREATE OR REPLACE FUNCTION public.aggregate_popularity_scores()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_updated int;
  v_deleted int;
BEGIN
  -- Aggregate deltas and update catalog_items
  WITH agg AS (
    SELECT product_id, SUM(delta) AS total_delta
    FROM public.product_popularity_events
    GROUP BY product_id
  )
  UPDATE public.catalog_items ci
  SET popularity_score = COALESCE(ci.popularity_score, 0) + agg.total_delta
  FROM agg
  WHERE ci.id = agg.product_id;

  GET DIAGNOSTICS v_updated = ROW_COUNT;

  -- Delete processed events
  DELETE FROM public.product_popularity_events;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  RETURN jsonb_build_object(
    'success', true,
    'products_updated', v_updated,
    'events_processed', v_deleted,
    'run_at', now()
  );
END;
$$;
