
-- ============================================================================
-- DB STABILITY & PERFORMANCE AUDIT MIGRATION (10k+ Users)
-- Version 2: Fixed column references
-- ============================================================================

-- ═══════════════════════════════════════════════════════════════════════════
-- SECTION A: CRITICAL INDEX ADDITIONS
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. user_roles: 856k seq scans - RLS covering index
DROP INDEX IF EXISTS idx_user_roles_admin_role;
DROP INDEX IF EXISTS idx_user_roles_admin_lookup;
DROP INDEX IF EXISTS idx_user_roles_user_id_role;
DROP INDEX IF EXISTS idx_user_roles_lookup;

CREATE INDEX IF NOT EXISTS idx_user_roles_rls_optimized 
ON public.user_roles (user_id, role, admin_role)
WHERE role = 'admin';

-- 2. settings: 48k seq scans vs 10 idx scans
CREATE UNIQUE INDEX IF NOT EXISTS idx_settings_singleton 
ON public.settings (id);

-- 3. maisha_payments: 81k seq scans
CREATE INDEX IF NOT EXISTS idx_maisha_payments_status 
ON public.maisha_payments (status);

CREATE INDEX IF NOT EXISTS idx_maisha_payments_order_status 
ON public.maisha_payments (order_id, status);

-- 4. quote_requests: uses order_item_id not order_id
CREATE INDEX IF NOT EXISTS idx_quote_requests_pending 
ON public.quote_requests (order_item_id, created_at DESC) 
WHERE status = 'pending';

-- ═══════════════════════════════════════════════════════════════════════════
-- SECTION B: CACHE TABLE OPTIMIZATION
-- ═══════════════════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS idx_catalog_cache_expires 
ON public.catalog_cache (expires_at);

CREATE INDEX IF NOT EXISTS idx_catalog_cache_stale 
ON public.catalog_cache (stale_at);

CREATE INDEX IF NOT EXISTS idx_catalog_item_media_provider_item 
ON public.catalog_item_media (provider, provider_item_id);

CREATE INDEX IF NOT EXISTS idx_product_cache_expires 
ON public.product_cache (expires_at);

CREATE INDEX IF NOT EXISTS idx_catalog_rate_limits_window 
ON public.catalog_rate_limits (window_start);

CREATE INDEX IF NOT EXISTS idx_rate_limits_expires 
ON public.rate_limits (expires_at);

CREATE INDEX IF NOT EXISTS idx_provider_budget_window 
ON public.provider_budget (window_start);

-- ═══════════════════════════════════════════════════════════════════════════
-- SECTION C: CART/ORDER PERFORMANCE
-- ═══════════════════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS idx_order_items_order_active 
ON public.order_items (order_id, is_saved_for_later, id);

CREATE INDEX IF NOT EXISTS idx_orders_user_created_desc 
ON public.orders (user_id, created_at DESC, id);

-- ═══════════════════════════════════════════════════════════════════════════
-- SECTION D: CATALOG ITEMS OPTIMIZATION
-- ═══════════════════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS idx_catalog_items_in_stock 
ON public.catalog_items (in_stock) 
WHERE in_stock = true AND is_disallowed = false;

CREATE INDEX IF NOT EXISTS idx_catalog_items_price 
ON public.catalog_items (price_usd) 
WHERE price_usd IS NOT NULL AND is_disallowed = false;

CREATE INDEX IF NOT EXISTS idx_catalog_items_category_price 
ON public.catalog_items (unified_category, price_usd DESC)
WHERE is_disallowed = false;

-- ═══════════════════════════════════════════════════════════════════════════
-- SECTION E: COMPREHENSIVE TTL CLEANUP FUNCTION
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.cleanup_all_expired_data()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
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
  
  DELETE FROM public.home_seen_items WHERE seen_at < now() - interval '7 days';
  GET DIAGNOSTICS v_home_seen_items_deleted = ROW_COUNT;
  
  DELETE FROM public.guest_cart_snapshots WHERE updated_at < now() - interval '30 days';
  GET DIAGNOSTICS v_guest_cart_snapshots_deleted = ROW_COUNT;
  
  DELETE FROM public.catalog_facets_cache WHERE expires_at < now();
  GET DIAGNOSTICS v_catalog_facets_cache_deleted = ROW_COUNT;
  
  RETURN jsonb_build_object(
    'success', true,
    'catalog_cache_deleted', v_catalog_cache_deleted,
    'catalog_rate_limits_deleted', v_catalog_rate_limits_deleted,
    'rate_limits_deleted', v_rate_limits_deleted,
    'product_cache_deleted', v_product_cache_deleted,
    'product_hot_cache_deleted', v_product_hot_cache_deleted,
    'provider_budget_deleted', v_provider_budget_deleted,
    'payment_attempts_expired', v_payment_attempts_expired,
    'home_seen_items_deleted', v_home_seen_items_deleted,
    'guest_cart_snapshots_deleted', v_guest_cart_snapshots_deleted,
    'catalog_facets_cache_deleted', v_catalog_facets_cache_deleted,
    'duration_ms', EXTRACT(MILLISECOND FROM clock_timestamp() - v_start_time)::integer,
    'cleanup_at', now()
  );
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- SECTION F: OPTIMIZED RLS HELPER FUNCTIONS
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.is_admin_role()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles 
    WHERE user_id = auth.uid() 
    AND role = 'admin'
  );
$$;

CREATE OR REPLACE FUNCTION public.is_super_admin_role()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles 
    WHERE user_id = auth.uid() 
    AND role = 'admin'
    AND admin_role = 'super_admin'
  );
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- SECTION G: ANALYZE TABLES
-- ═══════════════════════════════════════════════════════════════════════════

ANALYZE public.user_roles;
ANALYZE public.orders;
ANALYZE public.order_items;
ANALYZE public.profiles;
ANALYZE public.settings;
ANALYZE public.admin_settings;
ANALYZE public.catalog_items;
ANALYZE public.catalog_cache;
ANALYZE public.catalog_item_media;
ANALYZE public.maisha_payments;
