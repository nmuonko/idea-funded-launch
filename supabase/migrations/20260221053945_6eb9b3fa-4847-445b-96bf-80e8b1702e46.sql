
-- Fix #1: Lock down SECURITY DEFINER functions
REVOKE EXECUTE ON FUNCTION public.promote_popular_searches(integer, integer, boolean) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.cleanup_search_query_log(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.promote_popular_searches(integer, integer, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.cleanup_search_query_log(integer) TO service_role;

-- Fix #2: Unique partial index on catalog_refresh_queue for dedup
CREATE UNIQUE INDEX IF NOT EXISTS uq_refresh_queue_dedupe
ON public.catalog_refresh_queue (provider, category_key, query)
WHERE status IN ('queued', 'running');

-- Fix #3: Rewrite promote_popular_searches with proper candidate->promoted flow, spam filter, cap
CREATE OR REPLACE FUNCTION public.promote_popular_searches(
  p_min_searches integer DEFAULT 3,
  p_window_hours integer DEFAULT 24,
  p_auto_enqueue boolean DEFAULT true
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
  v_spam_filtered INTEGER := 0;
  rec RECORD;
BEGIN
  FOR rec IN
    SELECT 
      sq.q_norm,
      COUNT(*) AS search_count,
      AVG(sq.live_count)::NUMERIC(8,1) AS avg_results,
      AVG(sq.db_count)::NUMERIC(8,1) AS avg_db_results,
      MIN(sq.created_at) AS first_seen,
      MAX(sq.category_guess) AS category
    FROM public.search_query_log sq
    WHERE sq.created_at >= now() - (p_window_hours || ' hours')::interval
      AND length(sq.q_norm) >= 3
    GROUP BY sq.q_norm
    HAVING COUNT(*) >= p_min_searches
    ORDER BY COUNT(*) DESC
    LIMIT 50
  LOOP
    IF rec.q_norm ~ '^\d+$' THEN
      v_spam_filtered := v_spam_filtered + 1;
      CONTINUE;
    END IF;

    IF EXISTS (
      SELECT 1 FROM public.auto_seed_promotions 
      WHERE query_normalized = rec.q_norm AND status = 'rejected'
    ) THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    INSERT INTO public.auto_seed_promotions (
      query_normalized, search_count, avg_result_count, 
      first_seen_at, category_key, status, updated_at
    ) VALUES (
      rec.q_norm, rec.search_count, rec.avg_results,
      rec.first_seen, rec.category, 'candidate', now()
    )
    ON CONFLICT (query_normalized) DO UPDATE SET
      search_count = EXCLUDED.search_count,
      avg_result_count = EXCLUDED.avg_result_count,
      updated_at = now();

    v_promoted := v_promoted + 1;

    IF p_auto_enqueue AND rec.avg_db_results < 20 THEN
      UPDATE public.auto_seed_promotions 
      SET status = 'promoted', promoted_at = now(), updated_at = now()
      WHERE query_normalized = rec.q_norm AND status = 'candidate';

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
      ON CONFLICT (provider, category_key, query) WHERE status IN ('queued', 'running') DO NOTHING;
      
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
    'spam_filtered', v_spam_filtered,
    'run_at', now()
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.promote_popular_searches(integer, integer, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.promote_popular_searches(integer, integer, boolean) TO service_role;

-- Fix #4: Server-side RPC for aggregated popular queries
CREATE OR REPLACE FUNCTION public.get_popular_queries(
  p_window_hours integer DEFAULT 24,
  p_limit integer DEFAULT 50
)
RETURNS TABLE(
  q_norm text,
  search_count bigint,
  avg_db numeric,
  avg_live numeric,
  last_seen timestamptz,
  category_guess text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT 
    sq.q_norm,
    COUNT(*) AS search_count,
    ROUND(AVG(sq.db_count)::numeric, 0) AS avg_db,
    ROUND(AVG(sq.live_count)::numeric, 0) AS avg_live,
    MAX(sq.created_at) AS last_seen,
    MAX(sq.category_guess) AS category_guess
  FROM public.search_query_log sq
  WHERE sq.created_at >= now() - (p_window_hours || ' hours')::interval
    AND length(sq.q_norm) >= 2
  GROUP BY sq.q_norm
  ORDER BY COUNT(*) DESC
  LIMIT p_limit;
$$;

REVOKE EXECUTE ON FUNCTION public.get_popular_queries(integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_popular_queries(integer, integer) TO service_role;

-- Fix #5: RLS policies for admin-only access
CREATE POLICY "Admins can view search logs"
ON public.search_query_log
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid() AND role = 'admin'
  )
);

CREATE POLICY "Admins can view promotions"
ON public.auto_seed_promotions
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid() AND role = 'admin'
  )
);

CREATE POLICY "Admins can update promotions"
ON public.auto_seed_promotions
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid() AND role = 'admin'
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid() AND role = 'admin'
  )
);
