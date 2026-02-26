
-- =====================================================
-- Round 2: Backend Optimization Migration
-- =====================================================

-- 1. Drop 2 duplicate unique indexes on catalog_items (save 20MB)
DROP INDEX IF EXISTS idx_catalog_items_provider_product_id;
DROP INDEX IF EXISTS idx_catalog_items_provider_product;

-- 2. Drop 4 low-value indexes on catalog_items (save 18MB)
DROP INDEX IF EXISTS idx_catalog_items_last_seen;
DROP INDEX IF EXISTS idx_catalog_items_price_refresh;
DROP INDEX IF EXISTS idx_catalog_items_updated_at;
DROP INDEX IF EXISTS idx_catalog_items_price_usd;

-- 3. Drop 2 dead indexes on catalog_cache
DROP INDEX IF EXISTS idx_catalog_cache_stale;
DROP INDEX IF EXISTS idx_catalog_cache_type_updated;

-- 4. REINDEX catalog_cache to reclaim 28MB of bloat
REINDEX TABLE public.catalog_cache;

-- 5. Enable RLS on amazon_ingest_queue with service-role-only policy
ALTER TABLE public.amazon_ingest_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role only access"
  ON public.amazon_ingest_queue
  FOR ALL
  USING (false)
  WITH CHECK (false);

-- 6. Add service-role-only policies to tables with RLS but no policies
-- (These tables intentionally block anon/authenticated access; 
--  edge functions use service_role which bypasses RLS)

CREATE POLICY "Service role only access"
  ON public.product_popularity_events
  FOR ALL
  USING (false)
  WITH CHECK (false);

CREATE POLICY "Service role only access"
  ON public.query_translation_cache
  FOR ALL
  USING (false)
  WITH CHECK (false);

CREATE POLICY "Service role only access"
  ON public.product_variants_cache
  FOR ALL
  USING (false)
  WITH CHECK (false);

CREATE POLICY "Service role only access"
  ON public.catalog_home_cache
  FOR ALL
  USING (false)
  WITH CHECK (false);
