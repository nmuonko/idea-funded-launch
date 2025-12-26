-- =====================================================
-- PHASE 1: DATABASE INDEX OPTIMIZATION
-- =====================================================

-- Composite index for the most common query pattern: user's draft cart
CREATE INDEX IF NOT EXISTS idx_orders_user_status_composite 
ON orders (user_id, status);

-- Partial index for active cart items (excludes saved-for-later)
CREATE INDEX IF NOT EXISTS idx_order_items_active
ON order_items (order_id) 
WHERE is_saved_for_later = false;

-- Index for order items by order_id for faster joins
CREATE INDEX IF NOT EXISTS idx_order_items_order_id
ON order_items (order_id);

-- Singleton optimization for settings table
CREATE INDEX IF NOT EXISTS idx_settings_singleton 
ON settings ((true));

-- User roles lookup optimization
CREATE INDEX IF NOT EXISTS idx_user_roles_user_role
ON user_roles (user_id, role);

-- Maisha payments by order lookup
CREATE INDEX IF NOT EXISTS idx_maisha_payments_order
ON maisha_payments (order_id);

-- Checkout sessions by user
CREATE INDEX IF NOT EXISTS idx_checkout_sessions_user
ON checkout_sessions (user_id);

-- Support tickets by user and status
CREATE INDEX IF NOT EXISTS idx_support_tickets_user_status
ON support_tickets (user_id, status);

-- =====================================================
-- PHASE 2: RLS OPTIMIZATION - CACHED ADMIN CHECK
-- =====================================================

-- Create a more efficient cached admin check function
CREATE OR REPLACE FUNCTION public.is_admin_cached()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM user_roles 
    WHERE user_id = auth.uid() 
    AND role = 'admin'
  )
$$;

-- =====================================================
-- PHASE 3: BATCH OPERATIONS RPC
-- =====================================================

-- Create RPC for atomic draft order merge (used by mobile-get-cart)
CREATE OR REPLACE FUNCTION public.merge_draft_orders(
  p_primary_id uuid,
  p_secondary_ids uuid[]
) 
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_items_moved integer;
  v_orders_deleted integer;
BEGIN
  -- Move items from secondary drafts to primary
  UPDATE order_items 
  SET order_id = p_primary_id, updated_at = now()
  WHERE order_id = ANY(p_secondary_ids);
  
  GET DIAGNOSTICS v_items_moved = ROW_COUNT;
  
  -- Delete the now-empty secondary draft orders
  DELETE FROM orders WHERE id = ANY(p_secondary_ids);
  
  GET DIAGNOSTICS v_orders_deleted = ROW_COUNT;
  
  -- Increment cart version on primary
  UPDATE orders 
  SET cart_version = cart_version + 1, updated_at = now()
  WHERE id = p_primary_id;
  
  RETURN jsonb_build_object(
    'success', true,
    'items_moved', v_items_moved,
    'orders_deleted', v_orders_deleted
  );
END;
$$;

-- =====================================================
-- PHASE 4: PERFORMANCE METRICS TABLE
-- =====================================================

-- Create table for tracking edge function performance
CREATE TABLE IF NOT EXISTS public.performance_metrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  function_name text NOT NULL,
  duration_ms integer NOT NULL,
  success boolean DEFAULT true,
  user_id uuid,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now()
);

-- Index for time-series queries
CREATE INDEX IF NOT EXISTS idx_perf_metrics_timestamp 
ON performance_metrics (created_at DESC);

-- Index for function-specific queries
CREATE INDEX IF NOT EXISTS idx_perf_metrics_function 
ON performance_metrics (function_name, created_at DESC);

-- Enable RLS
ALTER TABLE public.performance_metrics ENABLE ROW LEVEL SECURITY;

-- Only admins can view metrics
CREATE POLICY "Admins can view performance metrics"
ON public.performance_metrics
FOR SELECT
USING (public.has_role(auth.uid(), 'admin'));

-- Service role can insert metrics
CREATE POLICY "Service role can insert metrics"
ON public.performance_metrics
FOR INSERT
WITH CHECK (true);

-- =====================================================
-- PHASE 5: SLOW QUERY SUMMARY FUNCTION
-- =====================================================

-- Create RPC for admin dashboard to view table statistics
CREATE OR REPLACE FUNCTION public.get_table_statistics()
RETURNS TABLE (
  table_name text,
  row_estimate bigint,
  seq_scans bigint,
  idx_scans bigint,
  index_usage_pct numeric
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = 'public'
AS $$
  SELECT 
    relname::text,
    n_live_tup,
    seq_scan,
    idx_scan,
    ROUND(100.0 * idx_scan / NULLIF(seq_scan + idx_scan, 0), 2)
  FROM pg_stat_user_tables 
  WHERE schemaname = 'public'
  ORDER BY seq_scan DESC
  LIMIT 20;
$$;

-- =====================================================
-- PHASE 6: REFRESH TABLE STATISTICS
-- =====================================================

-- Force statistics refresh for query planner
ANALYZE orders;
ANALYZE order_items;
ANALYZE profiles;
ANALYZE user_roles;
ANALYZE settings;
ANALYZE maisha_payments;
ANALYZE checkout_sessions;
ANALYZE support_tickets;