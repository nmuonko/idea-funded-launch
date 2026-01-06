-- =====================================================
-- BACKEND PERFORMANCE OPTIMIZATION
-- Add critical missing indexes to reduce sequential scans
-- =====================================================

-- 1. PROFILES: Add composite indexes for common lookups
CREATE INDEX IF NOT EXISTS idx_profiles_user_id_email 
  ON public.profiles (user_id, email);

-- 2. ORDERS: Improve user + status queries (most common pattern)
CREATE INDEX IF NOT EXISTS idx_orders_user_status_created 
  ON public.orders (user_id, status, created_at DESC);

-- 3. ORDERS: Draft orders lookup (cart queries)
CREATE INDEX IF NOT EXISTS idx_orders_draft_user 
  ON public.orders (user_id) 
  WHERE status = 'DRAFT';

-- 4. USER_ROLES: Critical for RLS is_admin() function
CREATE INDEX IF NOT EXISTS idx_user_roles_lookup 
  ON public.user_roles (user_id, role);

-- 5. USER_ROLES: Admin role specific lookup
CREATE INDEX IF NOT EXISTS idx_user_roles_admin 
  ON public.user_roles (user_id) 
  WHERE role = 'admin';

-- 6. SETTINGS: Ensure fast single-row lookup
CREATE INDEX IF NOT EXISTS idx_settings_singleton 
  ON public.settings (id);

-- 7. ADMIN_USER_PERMISSIONS: User lookup
CREATE INDEX IF NOT EXISTS idx_admin_permissions_user 
  ON public.admin_user_permissions (user_id);

-- 8. ORDER_ITEMS: Improve order_id + saved lookup
CREATE INDEX IF NOT EXISTS idx_order_items_order_active_status 
  ON public.order_items (order_id, is_saved_for_later, shipping_status);

-- 9. SUPPORT_TICKETS: Status + priority for admin queries
CREATE INDEX IF NOT EXISTS idx_support_tickets_status_priority 
  ON public.support_tickets (status, priority, created_at DESC);

-- 10. ADMIN_AUDIT_LOGS: Time-based queries
CREATE INDEX IF NOT EXISTS idx_admin_audit_created 
  ON public.admin_audit_logs (created_at DESC);

-- 11. KNOWLEDGE_BASE: Published articles lookup
CREATE INDEX IF NOT EXISTS idx_kb_published_category 
  ON public.knowledge_base_articles (published, category) 
  WHERE published = true;

-- =====================================================
-- Fix function search_path for security (linter warning)
-- =====================================================

-- Recreate is_admin with explicit search_path
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles 
    WHERE user_id = auth.uid() 
    AND role = 'admin'
  )
$$;

-- Recreate is_super_admin with explicit search_path  
CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles 
    WHERE user_id = auth.uid() 
    AND role = 'admin'
    AND admin_role = 'super_admin'
  )
$$;

-- Recreate is_admin_cached with explicit search_path
CREATE OR REPLACE FUNCTION public.is_admin_cached()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles 
    WHERE user_id = auth.uid() 
    AND role = 'admin'
  )
$$;

-- Recreate has_role with explicit search_path
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = 'public'
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
      AND role = _role
  )
$$;