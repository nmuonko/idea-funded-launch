
-- Fix promote_popular_searches: remove invalid WHERE from ON CONFLICT, add extra spam filters
CREATE OR REPLACE FUNCTION public.promote_popular_searches(p_min_searches integer DEFAULT 3, p_window_hours integer DEFAULT 24, p_auto_enqueue boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    -- Spam filter: numeric-only
    IF rec.q_norm ~ '^\d+$' THEN
      v_spam_filtered := v_spam_filtered + 1;
      CONTINUE;
    END IF;

    -- Spam filter: too many tokens (>6 words = likely pasted text)
    IF array_length(string_to_array(rec.q_norm, ' '), 1) > 6 THEN
      v_spam_filtered := v_spam_filtered + 1;
      CONTINUE;
    END IF;

    -- Spam filter: contains URLs, emails, or phone patterns
    IF rec.q_norm ~ '(https?://|\.com|\.org|\.net|@|(\+?\d[\d\s\-]{7,}))' THEN
      v_spam_filtered := v_spam_filtered + 1;
      CONTINUE;
    END IF;

    -- Skip previously rejected
    IF EXISTS (
      SELECT 1 FROM public.auto_seed_promotions 
      WHERE query_normalized = rec.q_norm AND status = 'rejected'
    ) THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    -- Insert as candidate first
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

    -- Auto-enqueue if low DB coverage
    IF p_auto_enqueue AND rec.avg_db_results < 20 THEN
      UPDATE public.auto_seed_promotions 
      SET status = 'promoted', promoted_at = now(), updated_at = now()
      WHERE query_normalized = rec.q_norm AND status = 'candidate';

      -- Fixed: removed invalid WHERE from ON CONFLICT (the partial unique index handles it)
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
      ON CONFLICT (provider, category_key, query) DO NOTHING;
      
      v_enqueued := v_enqueued + 1;
    END IF;
  END LOOP;

  -- Expire old candidates that were never promoted
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
$function$;

-- Re-apply permission lockdown
REVOKE EXECUTE ON FUNCTION public.promote_popular_searches(integer, integer, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.promote_popular_searches(integer, integer, boolean) TO service_role;
