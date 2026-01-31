-- =====================================================
-- Phase 3: DB Performance Audit - Remaining Optimizations
-- Target: 10k+ concurrent users
-- =====================================================

-- 1. Update table statistics for better query planning
ANALYZE public.user_roles;
ANALYZE public.profiles;
ANALYZE public.orders;
ANALYZE public.order_items;
ANALYZE public.admin_settings;
ANALYZE public.settings;
ANALYZE public.payment_providers;
ANALYZE public.shipping_item_types;
ANALYZE public.support_tickets;
ANALYZE public.support_conversations;
ANALYZE public.catalog_items;
ANALYZE public.catalog_cache;
ANALYZE public.checkout_sessions;

-- 2. Add missing indexes for remaining high-seq-scan tables

-- support_conversations: Admin inbox queries
CREATE INDEX IF NOT EXISTS idx_support_conversations_status_updated 
ON public.support_conversations (status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_support_conversations_active 
ON public.support_conversations (status, last_message_at DESC) 
WHERE status = 'active';

-- admin_users: Email lookup optimization
CREATE INDEX IF NOT EXISTS idx_admin_users_email_lookup 
ON public.admin_users (email);

-- quote_requests: High seq scan (199k) - add user and status indexes  
CREATE INDEX IF NOT EXISTS idx_quote_requests_user_status 
ON public.quote_requests (user_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_quote_requests_pending 
ON public.quote_requests (status, created_at DESC) 
WHERE status = 'pending';

-- payments table: Order lookup optimization
CREATE INDEX IF NOT EXISTS idx_payments_order_provider 
ON public.payments (order_id, provider_key);

CREATE INDEX IF NOT EXISTS idx_payments_status_lookup 
ON public.payments (order_id, status) 
WHERE status IN ('pending', 'succeeded');

-- price_confirmations: User and status queries
CREATE INDEX IF NOT EXISTS idx_price_confirmations_user_pending 
ON public.price_confirmations (user_id, status, created_at DESC);

-- admin_audit_logs: Time-based queries
CREATE INDEX IF NOT EXISTS idx_admin_audit_logs_created 
ON public.admin_audit_logs (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_admin_audit_logs_admin_action 
ON public.admin_audit_logs (admin_id, action_type, created_at DESC);

-- support_messages: Conversation lookup
CREATE INDEX IF NOT EXISTS idx_support_messages_conversation_created 
ON public.support_messages (conversation_id, created_at);

-- 3. Optimize RLS helper functions with covering index hints

-- Optimize has_role function to use covering index
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = 'public'
AS $$
  -- Uses idx_user_roles_rls_optimized covering index
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id 
      AND role = _role
    LIMIT 1
  )
$$;

-- Optimize is_admin_role with explicit LIMIT
CREATE OR REPLACE FUNCTION public.is_admin_role()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = 'public'
AS $$
  -- Uses idx_user_roles_rls_optimized covering index
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles 
    WHERE user_id = auth.uid() 
      AND role = 'admin'
    LIMIT 1
  );
$$;

-- Optimize is_super_admin_role with explicit LIMIT
CREATE OR REPLACE FUNCTION public.is_super_admin_role()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = 'public'
AS $$
  -- Uses idx_user_roles_rls_optimized covering index
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles 
    WHERE user_id = auth.uid() 
      AND role = 'admin'
      AND admin_role = 'super_admin'
    LIMIT 1
  );
$$;

-- Optimize can_view_customer_profiles with explicit LIMITs
CREATE OR REPLACE FUNCTION public.can_view_customer_profiles(user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = 'public'
AS $$
  -- Check super_admin first (most common admin case)
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_roles.user_id = can_view_customer_profiles.user_id
      AND admin_role = 'super_admin'
    LIMIT 1
  )
  OR EXISTS (
    -- Admins with explicit can_view_customers permission
    SELECT 1 FROM public.admin_user_permissions
    WHERE admin_user_permissions.user_id = can_view_customer_profiles.user_id
      AND can_view_customers = true
    LIMIT 1
  );
$$;

-- 4. Add partial index for draft orders (most common user query)
CREATE INDEX IF NOT EXISTS idx_orders_draft 
ON public.orders (user_id) 
WHERE status = 'DRAFT';

-- 5. Ensure singleton tables have proper indexes
CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_settings_singleton 
ON public.payment_settings ((true)) 
WHERE id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_bank_transfer_settings_singleton 
ON public.bank_transfer_settings ((true)) 
WHERE id IS NOT NULL;

-- 6. Add index for checkout_sessions maisha_reference lookup
CREATE INDEX IF NOT EXISTS idx_checkout_sessions_maisha_ref 
ON public.checkout_sessions (maisha_reference) 
WHERE maisha_reference IS NOT NULL;

-- 7. Add provider token expiry index for cleanup
CREATE INDEX IF NOT EXISTS idx_provider_tokens_expires 
ON public.provider_tokens (expires_at) 
WHERE expires_at IS NOT NULL;

-- 8. Add faq_kb index for active FAQs
CREATE INDEX IF NOT EXISTS idx_faq_kb_active_language 
ON public.faq_kb (is_active, language, priority) 
WHERE is_active = true;

-- 9. Create materialized view for admin dashboard stats (optional, for future use)
-- This can be refreshed periodically instead of computing on every request
-- COMMENTED OUT: Enable if dashboard becomes slow
/*
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_dashboard_stats AS
SELECT 
  (SELECT COUNT(*) FROM orders WHERE status = 'PENDING_PAYMENT') as pending_orders,
  (SELECT COUNT(*) FROM orders WHERE status = 'PAID' AND created_at > NOW() - INTERVAL '24 hours') as paid_today,
  (SELECT COUNT(*) FROM support_conversations WHERE status = 'active') as active_conversations,
  (SELECT COUNT(*) FROM quote_requests WHERE status = 'pending') as pending_quotes,
  NOW() as refreshed_at;

CREATE UNIQUE INDEX ON mv_dashboard_stats (refreshed_at);
*/

-- 10. Comment on critical indexes for documentation
COMMENT ON INDEX idx_user_roles_rls_optimized IS 'Covering index for RLS admin checks - CRITICAL for performance';
COMMENT ON INDEX idx_orders_draft IS 'Partial index for draft order lookups - most common user query';
COMMENT ON INDEX idx_order_items_cart_totals IS 'Covering index for cart calculations - eliminates row fetches';