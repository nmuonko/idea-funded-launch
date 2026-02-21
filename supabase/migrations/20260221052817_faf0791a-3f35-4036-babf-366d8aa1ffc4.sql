
-- =============================================================
-- 1. Auto-Seed Promotions — queries auto-promoted to refresh queue
-- =============================================================
CREATE TABLE public.auto_seed_promotions (
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
  CONSTRAINT uq_auto_seed_query UNIQUE (query_normalized)
);

CREATE INDEX idx_auto_seed_status ON public.auto_seed_promotions (status, search_count DESC);

ALTER TABLE public.auto_seed_promotions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on auto_seed_promotions"
  ON public.auto_seed_promotions
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- =============================================================
-- 2. DB function: promote_popular_searches
-- =============================================================
CREATE OR REPLACE FUNCTION public.promote_popular_searches(
  p_min_searches INTEGER DEFAULT 3,
  p_window_hours INTEGER DEFAULT 24,
  p_auto_enqueue BOOLEAN DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_promoted INTEGER := 0;
  v_enqueued INTEGER := 0;
  v_skipped INTEGER := 0;
  rec RECORD;
BEGIN
  FOR rec IN
    SELECT 
      sq.q_norm,
      COUNT(*) AS search_count,
      AVG(sq.live_count)::NUMERIC(8,1) AS avg_results,
      MIN(sq.created_at) AS first_seen,
      MAX(sq.category_guess) AS category
    FROM public.search_query_log sq
    WHERE sq.created_at >= now() - (p_window_hours || ' hours')::interval
      AND length(sq.q_norm) >= 3
    GROUP BY sq.q_norm
    HAVING COUNT(*) >= p_min_searches
  LOOP
    INSERT INTO public.auto_seed_promotions (
      query_normalized, search_count, avg_result_count, 
      first_seen_at, category_key, status, promoted_at, updated_at
    ) VALUES (
      rec.q_norm, rec.search_count, rec.avg_results,
      rec.first_seen, rec.category, 'promoted', now(), now()
    )
    ON CONFLICT (query_normalized) DO UPDATE SET
      search_count = EXCLUDED.search_count,
      avg_result_count = EXCLUDED.avg_result_count,
      updated_at = now(),
      status = CASE 
        WHEN auto_seed_promotions.status = 'rejected' THEN 'rejected'
        ELSE 'promoted'
      END
    WHERE auto_seed_promotions.status != 'rejected';

    IF EXISTS (
      SELECT 1 FROM public.auto_seed_promotions 
      WHERE query_normalized = rec.q_norm AND status = 'rejected'
    ) THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    v_promoted := v_promoted + 1;

    IF p_auto_enqueue AND rec.avg_results < 20 THEN
      INSERT INTO public.catalog_refresh_queue (
        category_key, provider, query, priority, status, scheduled_at
      ) VALUES (
        COALESCE(rec.category, 'general'),
        'ebay',
        rec.q_norm,
        5,
        'queued',
        now()
      )
      ON CONFLICT DO NOTHING;
      v_enqueued := v_enqueued + 1;
    END IF;
  END LOOP;

  UPDATE public.auto_seed_promotions
  SET status = 'expired', updated_at = now()
  WHERE status = 'candidate' 
    AND created_at < now() - interval '7 days';

  RETURN jsonb_build_object(
    'success', true,
    'promoted', v_promoted,
    'enqueued', v_enqueued,
    'skipped_rejected', v_skipped,
    'run_at', now()
  );
END;
$$;

-- =============================================================
-- 3. Cleanup function for old search logs (>30 days)
-- =============================================================
CREATE OR REPLACE FUNCTION public.cleanup_search_query_log(p_days INTEGER DEFAULT 30)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_deleted INTEGER;
BEGIN
  DELETE FROM public.search_query_log
  WHERE created_at < now() - (p_days || ' days')::interval;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  RETURN jsonb_build_object(
    'success', true,
    'deleted', v_deleted,
    'cleanup_at', now()
  );
END;
$$;
