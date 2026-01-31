-- Phase 1: Critical Database Fixes - Indexes and RLS Optimization

-- 1.1 Force statistics update on critical tables
ANALYZE user_roles;
ANALYZE orders;
ANALYZE profiles;
ANALYZE order_items;
ANALYZE shipping_item_types;
ANALYZE settings;
ANALYZE admin_settings;
ANALYZE maisha_payments;
ANALYZE quote_requests;
ANALYZE payment_providers;
ANALYZE catalog_items;
ANALYZE catalog_cache;

-- 1.2 Add missing composite indexes for query patterns (non-concurrent for transaction safety)
-- user_roles: Optimize RLS checks with covering index
CREATE INDEX IF NOT EXISTS idx_user_roles_user_lookup 
ON user_roles (user_id) INCLUDE (role, admin_role);

-- settings: Singleton optimization
CREATE UNIQUE INDEX IF NOT EXISTS idx_settings_singleton_id 
ON settings (id) WHERE id IS NOT NULL;

-- profiles: User lookup optimization with covering columns
CREATE INDEX IF NOT EXISTS idx_profiles_user_id_covering 
ON profiles (user_id) INCLUDE (email, full_name, country);

-- orders: Status-based queries (common admin patterns)
CREATE INDEX IF NOT EXISTS idx_orders_status_created 
ON orders (status, created_at DESC);

-- orders: User order lookup
CREATE INDEX IF NOT EXISTS idx_orders_user_status 
ON orders (user_id, status);

-- admin_settings: Key lookup optimization
CREATE INDEX IF NOT EXISTS idx_admin_settings_key_btree 
ON admin_settings USING btree (key);

-- order_items: Order lookup with saved_for_later filter
CREATE INDEX IF NOT EXISTS idx_order_items_order_active 
ON order_items (order_id) WHERE is_saved_for_later = false;

-- 1.3 Optimize RLS functions with EXISTS and LIMIT 1
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles 
    WHERE user_id = auth.uid() 
    AND role = 'admin'
    LIMIT 1
  )
$$;

CREATE OR REPLACE FUNCTION public.is_admin_cached()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles 
    WHERE user_id = auth.uid() 
    AND role = 'admin'
    LIMIT 1
  )
$$;

CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles 
    WHERE user_id = auth.uid() 
    AND role = 'admin'
    AND admin_role = 'super_admin'
    LIMIT 1
  )
$$;