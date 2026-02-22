
-- ═══════════════════════════════════════════════════════════
-- Prerequisite tables needed by enqueue_all_seeds_ebay
-- All IF NOT EXISTS / IF NOT EXISTS — safe no-ops on Test
-- ═══════════════════════════════════════════════════════════

-- 1. catalog_refresh_queue
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

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'catalog_refresh_queue' AND policyname = 'Service role full access on catalog_refresh_queue'
  ) THEN
    CREATE POLICY "Service role full access on catalog_refresh_queue"
      ON public.catalog_refresh_queue FOR ALL USING (false);
  END IF;
END $$;

-- Dedup index
CREATE UNIQUE INDEX IF NOT EXISTS uq_refresh_queue_dedupe
  ON public.catalog_refresh_queue (provider, category_key, query)
  WHERE status IN ('queued', 'running');

-- 2. catalog_category_ttl
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

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'catalog_category_ttl' AND policyname = 'Admins can read catalog_category_ttl'
  ) THEN
    CREATE POLICY "Admins can read catalog_category_ttl"
      ON public.catalog_category_ttl FOR SELECT
      USING (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin'));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'catalog_category_ttl' AND policyname = 'No public write to catalog_category_ttl'
  ) THEN
    CREATE POLICY "No public write to catalog_category_ttl"
      ON public.catalog_category_ttl FOR ALL USING (false) WITH CHECK (false);
  END IF;
END $$;

-- 3. search_query_log
CREATE TABLE IF NOT EXISTS public.search_query_log (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  q_norm text NOT NULL,
  q_original text,
  category_guess text,
  db_count integer DEFAULT 0,
  live_count integer DEFAULT 0,
  used_live boolean DEFAULT false,
  fuzzy_used boolean DEFAULT false,
  expansion_used boolean DEFAULT false,
  auto_cached_count integer DEFAULT 0,
  duration_ms integer,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_search_query_log_created ON public.search_query_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_search_query_log_qnorm ON public.search_query_log (q_norm);

ALTER TABLE public.search_query_log ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'search_query_log' AND policyname = 'Service role full access on search_query_log'
  ) THEN
    CREATE POLICY "Service role full access on search_query_log"
      ON public.search_query_log FOR ALL USING (false) WITH CHECK (false);
  END IF;
END $$;

-- 4. auto_seed_promotions
CREATE TABLE IF NOT EXISTS public.auto_seed_promotions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  query_normalized TEXT NOT NULL,
  search_count INTEGER NOT NULL DEFAULT 0,
  avg_result_count NUMERIC(8,1) DEFAULT 0,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  promoted_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'candidate',
  category_key TEXT,
  admin_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_refreshed_at timestamptz,
  last_refresh_count integer DEFAULT 0,
  last_refresh_status text,
  CONSTRAINT uq_auto_seed_query UNIQUE (query_normalized)
);

CREATE INDEX IF NOT EXISTS idx_auto_seed_status ON public.auto_seed_promotions (status, search_count DESC);

ALTER TABLE public.auto_seed_promotions ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'auto_seed_promotions' AND policyname = 'Service role full access on auto_seed_promotions'
  ) THEN
    CREATE POLICY "Service role full access on auto_seed_promotions"
      ON public.auto_seed_promotions FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════
-- Now recreate the function (safe CREATE OR REPLACE)
-- ═══════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.enqueue_all_seeds_ebay(p_limit integer DEFAULT 2000)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_before integer;
  v_after integer;
  v_enqueued integer;
BEGIN
  SELECT COUNT(*) INTO v_before
  FROM public.catalog_refresh_queue
  WHERE status IN ('queued', 'running') AND provider = 'ebay';

  INSERT INTO public.catalog_refresh_queue (category_key, provider, query, priority, status, scheduled_at)
  SELECT 
    sq.category,
    'ebay',
    sq.query,
    9,
    'queued',
    now()
  FROM public.catalog_seed_queries sq
  WHERE sq.enabled = true
    AND length(sq.query) >= 3
  LIMIT p_limit
  ON CONFLICT DO NOTHING;

  GET DIAGNOSTICS v_enqueued = ROW_COUNT;

  SELECT COUNT(*) INTO v_after
  FROM public.catalog_refresh_queue
  WHERE status IN ('queued', 'running') AND provider = 'ebay';

  RETURN jsonb_build_object(
    'enqueued', v_enqueued,
    'total_queued', v_after,
    'run_at', now()
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.enqueue_all_seeds_ebay(integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.enqueue_all_seeds_ebay(integer) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.enqueue_all_seeds_ebay(integer) FROM anon;
