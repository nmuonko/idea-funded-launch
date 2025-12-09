
-- ============================================
-- PHASE 1: CRITICAL PERFORMANCE INDEXES
-- ============================================

-- profiles table (highest priority - 146k seq scans)
CREATE INDEX IF NOT EXISTS idx_profiles_email ON public.profiles(email);
CREATE INDEX IF NOT EXISTS idx_profiles_country ON public.profiles(country);
CREATE INDEX IF NOT EXISTS idx_profiles_user_id_email ON public.profiles(user_id, email);
CREATE INDEX IF NOT EXISTS idx_profiles_language ON public.profiles(language);

-- maisha_payments table (order lookups)
CREATE INDEX IF NOT EXISTS idx_maisha_payments_order_id ON public.maisha_payments(order_id);
CREATE INDEX IF NOT EXISTS idx_maisha_payments_confirmation_code ON public.maisha_payments(confirmation_code);
CREATE INDEX IF NOT EXISTS idx_maisha_payments_user_id ON public.maisha_payments(user_id);
CREATE INDEX IF NOT EXISTS idx_maisha_payments_status ON public.maisha_payments(status);
CREATE INDEX IF NOT EXISTS idx_maisha_payments_created_at ON public.maisha_payments(created_at DESC);

-- support_tickets table (6k seq scans)
CREATE INDEX IF NOT EXISTS idx_support_tickets_user_id ON public.support_tickets(user_id);
CREATE INDEX IF NOT EXISTS idx_support_tickets_status ON public.support_tickets(status);
CREATE INDEX IF NOT EXISTS idx_support_tickets_priority ON public.support_tickets(priority);
CREATE INDEX IF NOT EXISTS idx_support_tickets_created_at ON public.support_tickets(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_support_tickets_assigned_to ON public.support_tickets(assigned_to);

-- orders table (critical for admin queries)
CREATE INDEX IF NOT EXISTS idx_orders_user_id ON public.orders(user_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON public.orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON public.orders(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_user_status ON public.orders(user_id, status);

-- order_items table
CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON public.order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_order_items_shipping_status ON public.order_items(shipping_status);
CREATE INDEX IF NOT EXISTS idx_order_items_store ON public.order_items(store);

-- user_roles table (RLS helper queries)
CREATE INDEX IF NOT EXISTS idx_user_roles_user_id ON public.user_roles(user_id);
CREATE INDEX IF NOT EXISTS idx_user_roles_user_role ON public.user_roles(user_id, role);
CREATE INDEX IF NOT EXISTS idx_user_roles_admin_role ON public.user_roles(user_id, role, admin_role);

-- ticket_messages table
CREATE INDEX IF NOT EXISTS idx_ticket_messages_ticket_id ON public.ticket_messages(ticket_id);
CREATE INDEX IF NOT EXISTS idx_ticket_messages_created_at ON public.ticket_messages(created_at DESC);

-- order_actions table
CREATE INDEX IF NOT EXISTS idx_order_actions_order_id ON public.order_actions(order_id);
CREATE INDEX IF NOT EXISTS idx_order_actions_created_at ON public.order_actions(created_at DESC);

-- quote_requests table
CREATE INDEX IF NOT EXISTS idx_quote_requests_user_id ON public.quote_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_quote_requests_status ON public.quote_requests(status);
CREATE INDEX IF NOT EXISTS idx_quote_requests_order_item_id ON public.quote_requests(order_item_id);

-- admin_audit_logs table
CREATE INDEX IF NOT EXISTS idx_admin_audit_logs_admin_id ON public.admin_audit_logs(admin_id);
CREATE INDEX IF NOT EXISTS idx_admin_audit_logs_created_at ON public.admin_audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_audit_logs_action_type ON public.admin_audit_logs(action_type);

-- knowledge_base_articles table
CREATE INDEX IF NOT EXISTS idx_kb_articles_category ON public.knowledge_base_articles(category);
CREATE INDEX IF NOT EXISTS idx_kb_articles_published ON public.knowledge_base_articles(published);

-- customer_tag_assignments table
CREATE INDEX IF NOT EXISTS idx_tag_assignments_customer ON public.customer_tag_assignments(customer_id);
CREATE INDEX IF NOT EXISTS idx_tag_assignments_tag ON public.customer_tag_assignments(tag_id);

-- ============================================
-- PHASE 2: PARTIAL INDEXES (Sparse Data)
-- ============================================

-- Only index saved-for-later items (rare condition)
CREATE INDEX IF NOT EXISTS idx_order_items_saved_partial 
ON public.order_items(order_id, saved_at) 
WHERE is_saved_for_later = true;

-- Only index vehicles (rare)
CREATE INDEX IF NOT EXISTS idx_order_items_vehicles 
ON public.order_items(order_id) 
WHERE is_vehicle = true;

-- Only index manual quote items
CREATE INDEX IF NOT EXISTS idx_order_items_manual_quote 
ON public.order_items(order_id) 
WHERE requires_manual_quote = true;

-- Only index escalated tickets
CREATE INDEX IF NOT EXISTS idx_tickets_escalated 
ON public.support_tickets(user_id, created_at) 
WHERE escalated = true;

-- Only index active shipping types
CREATE INDEX IF NOT EXISTS idx_shipping_types_active 
ON public.shipping_item_types(key) 
WHERE active = true;

-- Only index published articles
CREATE INDEX IF NOT EXISTS idx_kb_published_articles 
ON public.knowledge_base_articles(category, created_at DESC) 
WHERE published = true;

-- Draft orders (for cart queries)
CREATE INDEX IF NOT EXISTS idx_orders_draft 
ON public.orders(user_id, created_at DESC) 
WHERE status = 'DRAFT';

-- Pending payment orders
CREATE INDEX IF NOT EXISTS idx_orders_pending_payment 
ON public.orders(created_at DESC) 
WHERE status = 'PENDING_PAYMENT';

-- ============================================
-- PHASE 3: OPTIMIZED RLS HELPER FUNCTIONS
-- ============================================

-- Fast admin check function (cached per session)
CREATE OR REPLACE FUNCTION public.is_admin()
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

-- Fast super admin check function
CREATE OR REPLACE FUNCTION public.is_super_admin()
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
    AND admin_role = 'super_admin'
  )
$$;

-- ============================================
-- PHASE 4: SECURITY FIXES
-- ============================================

-- Remove overly permissive settings policy (exposes pricing data)
DROP POLICY IF EXISTS "Authenticated users can view basic settings" ON public.settings;

-- Create restricted settings view for non-admin users (only exchange rate)
CREATE OR REPLACE VIEW public.public_settings AS
SELECT 
  exchange_rate_usd_to_cdf
FROM public.settings
LIMIT 1;

-- Grant access to the safe view
GRANT SELECT ON public.public_settings TO authenticated;

-- Ensure audit logs cannot be deleted
DROP POLICY IF EXISTS "No one can delete audit logs" ON public.admin_audit_logs;
CREATE POLICY "No one can delete audit logs" 
ON public.admin_audit_logs
FOR DELETE TO public 
USING (false);

-- ============================================
-- PHASE 5: BACKFILL MISSING DATA
-- ============================================

-- Backfill missing user_ids in maisha_payments from orders
UPDATE public.maisha_payments mp
SET user_id = o.user_id
FROM public.orders o
WHERE mp.order_id = o.id AND mp.user_id IS NULL;

-- ============================================
-- PHASE 6: ANALYZE TABLES FOR QUERY PLANNER
-- ============================================

ANALYZE public.profiles;
ANALYZE public.orders;
ANALYZE public.order_items;
ANALYZE public.maisha_payments;
ANALYZE public.support_tickets;
ANALYZE public.user_roles;
ANALYZE public.settings;
