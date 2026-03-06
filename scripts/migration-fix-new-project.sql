-- ============================================================
-- Migration Readiness Fix Script
-- Run this on the NEW Supabase project (ecqpqtirhpumfgbdtvhh)
-- ============================================================

-- ═══════════════════════════════════════════════════════════
-- 1. CREATE MISSING TABLE: shipping_item_types
-- ═══════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.shipping_item_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL,
  label text NOT NULL,
  description text,
  est_weight_kg numeric NOT NULL,
  requires_manual_quote boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.shipping_item_types ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to read
CREATE POLICY "Anyone can read shipping item types"
  ON public.shipping_item_types FOR SELECT
  USING (true);

-- Seed data
INSERT INTO public.shipping_item_types (id, key, label, description, est_weight_kg, requires_manual_quote, active) VALUES
  ('167286ca-9f56-48da-824f-fb0c68695335', 'small_electronics', 'Small electronics', 'Phones, earbuds, smartwatches, cameras', 0.7, false, true),
  ('c41362cf-71cc-431a-bd03-72a9dc97d57b', 'clothes_shoes', 'Clothes / Shoes', 'Clothing, footwear, accessories', 0.5, false, true),
  ('dab6588e-7a4c-42fb-b290-9e4f1d5ff8a9', 'laptop_tablet', 'Laptop / Tablet', 'MacBook, Chromebook, iPad, Surface', 2.5, false, true),
  ('f80bdb0a-e9a1-4b5c-bd07-23fb4c3759ae', 'console_medium', 'Console / Medium electronics', 'PlayStation, Xbox, printers, monitors', 6, false, true),
  ('348bb11c-b161-45f6-bd3a-24be0782a27b', 'tv_large_appliance', 'TV / Large appliance / Furniture', 'TVs, refrigerators, furniture, large items', 12, true, true)
ON CONFLICT (id) DO NOTHING;


-- ═══════════════════════════════════════════════════════════
-- 2. POPULATE catalog_category_ttl (at least 1 row)
-- ═══════════════════════════════════════════════════════════
INSERT INTO public.catalog_category_ttl (category_key, max_item_age_days, price_refresh_days, availability_refresh_days, db_min_results, enabled)
VALUES ('general', 90, 7, 3, 20, true)
ON CONFLICT (category_key) DO NOTHING;


-- ═══════════════════════════════════════════════════════════
-- 3. CREATE has_role() RPC FUNCTION
-- ═══════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id 
      AND role = _role
    LIMIT 1
  )
$$;


-- ═══════════════════════════════════════════════════════════
-- 4. CREATE helper functions used by cron jobs
-- ═══════════════════════════════════════════════════════════

-- 4a. _cron_call_refresh_worker (used by catalog-builder, pool-fill, stale, queue)
CREATE OR REPLACE FUNCTION public._cron_call_refresh_worker(p_mode text, p_body jsonb DEFAULT '{}'::jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_base_url text;
  v_url text;
  v_headers jsonb;
BEGIN
  SELECT value INTO v_base_url
  FROM public.admin_settings
  WHERE key = 'edge_function_base_url'
  LIMIT 1;

  IF v_base_url IS NULL OR v_base_url = '' THEN
    v_base_url := 'https://ecqpqtirhpumfgbdtvhh.supabase.co/functions/v1';
  END IF;

  v_url := v_base_url || '/catalog-refresh-worker';
  v_headers := jsonb_build_object(
    'Content-Type', 'application/json',
    'x-internal-cron-key', 'afrishop-internal-cron-2026'
  );

  PERFORM net.http_post(
    url := v_url,
    headers := v_headers,
    body := p_body || jsonb_build_object('mode', p_mode)
  );
END;
$$;

-- 4b. aggregate_popularity_scores (daily job)
CREATE OR REPLACE FUNCTION public.aggregate_popularity_scores()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_updated int;
  v_deleted int;
BEGIN
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

-- 4c. promote_popular_searches (6h job)
CREATE OR REPLACE FUNCTION public.promote_popular_searches(
  p_min_searches integer DEFAULT 3,
  p_window_hours integer DEFAULT 24,
  p_auto_enqueue boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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
    IF rec.q_norm ~ '^\d+$' THEN v_spam_filtered := v_spam_filtered + 1; CONTINUE; END IF;
    IF array_length(string_to_array(rec.q_norm, ' '), 1) > 6 THEN v_spam_filtered := v_spam_filtered + 1; CONTINUE; END IF;
    IF rec.q_norm ~ '(https?://|\.com|\.org|\.net|@|(\+?\d[\d\s\-]{7,}))' THEN v_spam_filtered := v_spam_filtered + 1; CONTINUE; END IF;

    IF EXISTS (
      SELECT 1 FROM public.auto_seed_promotions 
      WHERE query_normalized = rec.q_norm AND status = 'rejected'
    ) THEN v_skipped := v_skipped + 1; CONTINUE; END IF;

    INSERT INTO public.auto_seed_promotions (
      query_normalized, search_count, avg_result_count, first_seen_at, category_key, status, updated_at
    ) VALUES (rec.q_norm, rec.search_count, rec.avg_results, rec.first_seen, rec.category, 'candidate', now())
    ON CONFLICT (query_normalized) DO UPDATE SET
      search_count = EXCLUDED.search_count, avg_result_count = EXCLUDED.avg_result_count, updated_at = now();

    v_promoted := v_promoted + 1;

    IF p_auto_enqueue AND rec.avg_db_results < 20 THEN
      UPDATE public.auto_seed_promotions 
      SET status = 'promoted', promoted_at = now(), updated_at = now()
      WHERE query_normalized = rec.q_norm AND status = 'candidate';

      INSERT INTO public.catalog_refresh_queue (category_key, provider, query, priority, status, scheduled_at)
      VALUES (COALESCE(rec.category, 'general'), 'ebay', rec.q_norm, 5, 'queued', now())
      ON CONFLICT DO NOTHING;
      
      v_enqueued := v_enqueued + 1;
    END IF;
  END LOOP;

  UPDATE public.auto_seed_promotions
  SET status = 'expired', updated_at = now()
  WHERE status = 'candidate' AND created_at < now() - interval '7 days';

  RETURN jsonb_build_object(
    'success', true, 'promoted', v_promoted, 'enqueued', v_enqueued,
    'skipped_rejected', v_skipped, 'spam_filtered', v_spam_filtered, 'run_at', now()
  );
END;
$$;


-- ═══════════════════════════════════════════════════════════
-- 5. CREATE ALL 18 pg_cron JOBS
-- ═══════════════════════════════════════════════════════════

-- 5.1 Aggregate popularity daily at 4am
SELECT cron.schedule('aggregate-popularity-daily', '0 4 * * *', $$
  SELECT public.aggregate_popularity_scores();
$$);

-- 5.2 Amazon ingest worker every 30m
SELECT cron.schedule('amazon-ingest-worker-30m', '*/30 * * * *', $$
  SELECT net.http_post(
    url:='https://ecqpqtirhpumfgbdtvhh.supabase.co/functions/v1/catalog-amazon-ingest-worker',
    headers:='{"Content-Type":"application/json","x-internal-cron-key":"afrishop-internal-cron-2026"}'::jsonb,
    body:=concat('{"time": "', now(), '"}')::jsonb
  ) AS request_id;
$$);

-- 5.3 Analyze critical tables daily at 3am
SELECT cron.schedule('analyze-critical-tables-daily', '0 3 * * *', $$
  ANALYZE user_roles;
  ANALYZE orders;
  ANALYZE order_items;
  ANALYZE profiles;
  ANALYZE catalog_items;
  ANALYZE catalog_cache;
$$);

-- 5.4 CarGurus scraper every 3h
SELECT cron.schedule('car-scraper-cargurus-15m', '0 */3 * * *', $$
  SELECT net.http_post(
    url:='https://ecqpqtirhpumfgbdtvhh.supabase.co/functions/v1/catalog-car-scraper',
    headers:='{"Content-Type":"application/json","x-cron-secret":"afrishop-internal-cron-2026"}'::jsonb,
    body:='{"provider":"cargurus"}'::jsonb
  );
$$);

-- 5.5 Carvana scraper staggered 8x/day
SELECT cron.schedule('car-scraper-carvana-15m', '30 0,3,6,9,12,15,18,21 * * *', $$
  SELECT net.http_post(
    url:='https://ecqpqtirhpumfgbdtvhh.supabase.co/functions/v1/catalog-car-scraper',
    headers:='{"Content-Type":"application/json","x-cron-secret":"afrishop-internal-cron-2026"}'::jsonb,
    body:='{"provider":"carvana"}'::jsonb
  );
$$);

-- 5.6 Catalog builder campaign every 10m
SELECT cron.schedule('catalog-builder-campaign', '*/10 * * * *', $$
  SELECT public._cron_call_refresh_worker('catalog-builder');
$$);

-- 5.7 Catalog pool fill daily at 3am
SELECT cron.schedule('catalog-pool-fill-daily', '0 3 * * *', $$
  SELECT public._cron_call_refresh_worker('pool-fill', '{}'::jsonb);
$$);

-- 5.8 Prewarm home cache every 12h
SELECT cron.schedule('catalog-prewarm-home-12h', '0 */12 * * *', $$
  SELECT net.http_post(
    url:='https://ecqpqtirhpumfgbdtvhh.supabase.co/functions/v1/catalog-prewarm-home',
    headers:='{"Content-Type":"application/json","x-cron-secret":"afrishop-internal-cron-2026"}'::jsonb,
    body:='{}'::jsonb
  ) AS request_id;
$$);

-- 5.9 Catalog refresh stale every 6h
SELECT cron.schedule('catalog-refresh-stale-6h', '30 */6 * * *', $$
  SELECT public._cron_call_refresh_worker('stale', '{"maxJobs":20}'::jsonb);
$$);

-- 5.10 Catalog refresh worker queue every 30m
SELECT cron.schedule('catalog-refresh-worker-queue', '*/30 * * * *', $$
  SELECT public._cron_call_refresh_worker('queue', '{"maxJobs":50}'::jsonb);
$$);

-- 5.11 Cleanup expired data every 6h
SELECT cron.schedule('cleanup-all-expired-data-6h', '0 */6 * * *', $$
  SELECT net.http_post(
    url:='https://ecqpqtirhpumfgbdtvhh.supabase.co/functions/v1/cleanup-expired-data',
    headers:='{"Content-Type":"application/json","x-cron-secret":"afrishop-internal-cron-2026"}'::jsonb,
    body:='{}'::jsonb
  ) AS request_id;
$$);

-- 5.12 Cleanup expired carts daily at 2am
SELECT cron.schedule('cleanup-expired-carts-daily', '0 2 * * *', $$
  SELECT net.http_post(
    url:='https://ecqpqtirhpumfgbdtvhh.supabase.co/functions/v1/cleanup-expired-carts',
    headers:='{"Content-Type":"application/json","x-cron-secret":"afrishop-internal-cron-2026"}'::jsonb,
    body:='{}'::jsonb
  ) AS request_id;
$$);

-- 5.13 Link check every 6h
SELECT cron.schedule('link-check-every-6h', '0 */6 * * *', $$
  SELECT net.http_post(
    url:='https://ecqpqtirhpumfgbdtvhh.supabase.co/functions/v1/catalog-refresh-worker',
    headers:='{"Content-Type":"application/json","x-internal-cron-key":"afrishop-internal-cron-2026"}'::jsonb,
    body:='{"mode": "link-check", "batch_size": 100}'::jsonb
  ) as request_id;
$$);

-- 5.14 Promote popular searches every 6h
SELECT cron.schedule('promote-popular-searches-6h', '0 */6 * * *', $$
  SELECT public.promote_popular_searches(3, 24, true);
$$);

-- 5.15 Reconcile payments hourly
SELECT cron.schedule('reconcile-payments-hourly', '0 * * * *', $$
  SELECT net.http_post(
    url:='https://ecqpqtirhpumfgbdtvhh.supabase.co/functions/v1/reconcile-payment-status',
    headers:='{"Content-Type":"application/json","x-cron-secret":"afrishop-internal-cron-2026"}'::jsonb,
    body:='{}'::jsonb
  ) as request_id;
$$);

-- 5.16 Saved cart reminders daily at 9am
SELECT cron.schedule('saved-cart-reminders-daily', '0 9 * * *', $$
  SELECT net.http_post(
    url:='https://ecqpqtirhpumfgbdtvhh.supabase.co/functions/v1/saved-cart-reminders',
    headers:='{"Content-Type":"application/json","x-cron-secret":"afrishop-internal-cron-2026"}'::jsonb,
    body:='{}'::jsonb
  ) as request_id;
$$);

-- 5.17 Abandoned cart recovery daily at 10am
SELECT cron.schedule('send-abandoned-cart-recovery-daily', '0 10 * * *', $$
  SELECT net.http_post(
    url:='https://ecqpqtirhpumfgbdtvhh.supabase.co/functions/v1/send-abandoned-cart-recovery',
    headers:='{"Content-Type":"application/json","x-cron-secret":"afrishop-internal-cron-2026"}'::jsonb,
    body:='{}'::jsonb
  ) as request_id;
$$);

-- 5.18 SHEIN scraper every 2h
SELECT cron.schedule('shein-scraper-15m', '0 */2 * * *', $$
  SELECT net.http_post(
    url:='https://ecqpqtirhpumfgbdtvhh.supabase.co/functions/v1/catalog-shein-scraper',
    headers:='{"Content-Type":"application/json","x-cron-secret":"afrishop-internal-cron-2026"}'::jsonb,
    body:='{}'::jsonb
  );
$$);
