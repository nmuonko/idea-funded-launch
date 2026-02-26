
-- =====================================================
-- Go-Live QA Fixes: Data Hygiene + Security Hardening
-- =====================================================

-- 1. Cancel stale PENDING_PAYMENT orders (no active payment attempts, older than 48h)
UPDATE public.orders SET status = 'CANCELLED', updated_at = now()
WHERE status = 'PENDING_PAYMENT'
AND created_at < now() - interval '48 hours'
AND NOT EXISTS (
  SELECT 1 FROM public.payment_attempts pa 
  WHERE pa.order_id = orders.id AND pa.status IN ('pending', 'paid')
);

-- 2. Delete empty DRAFT orders older than 7 days
DELETE FROM public.orders WHERE status = 'DRAFT'
AND created_at < now() - interval '7 days'
AND NOT EXISTS (SELECT 1 FROM public.order_items oi WHERE oi.order_id = orders.id);

-- 3. Fix update_runtime_config_version: add SECURITY DEFINER + search_path
CREATE OR REPLACE FUNCTION public.update_runtime_config_version()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  NEW.version := (EXTRACT(EPOCH FROM now()) * 1000)::bigint;
  NEW.updated_at := now();
  RETURN NEW;
END;
$function$;

-- 4. Add RLS policies for tables with RLS enabled but no policies
CREATE POLICY "Service role only" ON public.catalog_home_mobile_sections_cache
  FOR ALL USING (false) WITH CHECK (false);

CREATE POLICY "Service role only" ON public.search_rewrite_cache
  FOR ALL USING (false) WITH CHECK (false);

-- 5. Enhance cleanup_all_expired_data() to handle stale orders going forward
CREATE OR REPLACE FUNCTION public.cleanup_all_expired_data()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_catalog_cache_deleted integer := 0;
  v_catalog_rate_limits_deleted integer := 0;
  v_rate_limits_deleted integer := 0;
  v_product_cache_deleted integer := 0;
  v_product_hot_cache_deleted integer := 0;
  v_provider_budget_deleted integer := 0;
  v_payment_attempts_expired integer := 0;
  v_home_seen_items_deleted integer := 0;
  v_guest_cart_snapshots_deleted integer := 0;
  v_catalog_facets_cache_deleted integer := 0;
  v_variants_cache_deleted integer := 0;
  v_translation_cache_deleted integer := 0;
  v_stale_orders_cancelled integer := 0;
  v_empty_drafts_deleted integer := 0;
  v_start_time timestamptz := clock_timestamp();
BEGIN
  DELETE FROM public.catalog_cache WHERE expires_at < now() - interval '1 hour';
  GET DIAGNOSTICS v_catalog_cache_deleted = ROW_COUNT;
  
  DELETE FROM public.catalog_rate_limits WHERE window_start < now() - interval '2 hours';
  GET DIAGNOSTICS v_catalog_rate_limits_deleted = ROW_COUNT;
  
  DELETE FROM public.rate_limits WHERE expires_at < now();
  GET DIAGNOSTICS v_rate_limits_deleted = ROW_COUNT;
  
  DELETE FROM public.product_cache WHERE expires_at < now();
  GET DIAGNOSTICS v_product_cache_deleted = ROW_COUNT;
  
  DELETE FROM public.product_hot_cache WHERE expires_at < now();
  GET DIAGNOSTICS v_product_hot_cache_deleted = ROW_COUNT;
  
  DELETE FROM public.provider_budget WHERE window_start < now() - interval '48 hours';
  GET DIAGNOSTICS v_provider_budget_deleted = ROW_COUNT;
  
  UPDATE public.payment_attempts SET status = 'expired', updated_at = now()
  WHERE status = 'pending' AND expires_at < now();
  GET DIAGNOSTICS v_payment_attempts_expired = ROW_COUNT;
  
  -- Cancel stale PENDING_PAYMENT orders with no active payment attempts
  UPDATE public.orders SET status = 'CANCELLED', updated_at = now()
  WHERE status = 'PENDING_PAYMENT'
  AND created_at < now() - interval '48 hours'
  AND NOT EXISTS (
    SELECT 1 FROM public.payment_attempts pa 
    WHERE pa.order_id = orders.id AND pa.status IN ('pending', 'paid')
  );
  GET DIAGNOSTICS v_stale_orders_cancelled = ROW_COUNT;
  
  -- Delete empty DRAFT orders older than 7 days
  DELETE FROM public.orders WHERE status = 'DRAFT'
  AND created_at < now() - interval '7 days'
  AND NOT EXISTS (SELECT 1 FROM public.order_items oi WHERE oi.order_id = orders.id);
  GET DIAGNOSTICS v_empty_drafts_deleted = ROW_COUNT;
  
  DELETE FROM public.home_seen_items WHERE seen_at < now() - interval '7 days';
  GET DIAGNOSTICS v_home_seen_items_deleted = ROW_COUNT;
  
  DELETE FROM public.guest_cart_snapshots WHERE updated_at < now() - interval '30 days';
  GET DIAGNOSTICS v_guest_cart_snapshots_deleted = ROW_COUNT;
  
  DELETE FROM public.catalog_facets_cache WHERE expires_at < now();
  GET DIAGNOSTICS v_catalog_facets_cache_deleted = ROW_COUNT;

  DELETE FROM public.product_variants_cache WHERE expires_at < now();
  GET DIAGNOSTICS v_variants_cache_deleted = ROW_COUNT;

  DELETE FROM public.query_translation_cache WHERE expires_at < now();
  GET DIAGNOSTICS v_translation_cache_deleted = ROW_COUNT;
  
  RETURN jsonb_build_object(
    'success', true,
    'catalog_cache_deleted', v_catalog_cache_deleted,
    'catalog_rate_limits_deleted', v_catalog_rate_limits_deleted,
    'rate_limits_deleted', v_rate_limits_deleted,
    'product_cache_deleted', v_product_cache_deleted,
    'product_hot_cache_deleted', v_product_hot_cache_deleted,
    'provider_budget_deleted', v_provider_budget_deleted,
    'payment_attempts_expired', v_payment_attempts_expired,
    'stale_orders_cancelled', v_stale_orders_cancelled,
    'empty_drafts_deleted', v_empty_drafts_deleted,
    'home_seen_items_deleted', v_home_seen_items_deleted,
    'guest_cart_snapshots_deleted', v_guest_cart_snapshots_deleted,
    'catalog_facets_cache_deleted', v_catalog_facets_cache_deleted,
    'variants_cache_deleted', v_variants_cache_deleted,
    'translation_cache_deleted', v_translation_cache_deleted,
    'duration_ms', EXTRACT(MILLISECOND FROM clock_timestamp() - v_start_time)::integer,
    'cleanup_at', now()
  );
END;
$function$;
