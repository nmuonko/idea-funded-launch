
-- =====================================================
-- Round 3: Dead Index Cleanup (indexes + constraints)
-- =====================================================

-- 1. catalog_items: dead boolean index
DROP INDEX IF EXISTS idx_catalog_items_is_disallowed;

-- 2. catalog_seed_queries: drop duplicate unique constraint
ALTER TABLE public.catalog_seed_queries DROP CONSTRAINT IF EXISTS catalog_seed_queries_provider_seed_key_key;

-- 3. admin_audit_logs: 5 dead indexes
DROP INDEX IF EXISTS idx_admin_audit_logs_action_type;
DROP INDEX IF EXISTS idx_admin_audit_logs_admin_id;
DROP INDEX IF EXISTS idx_admin_audit_logs_admin_action;
DROP INDEX IF EXISTS idx_admin_audit_created;
DROP INDEX IF EXISTS idx_admin_audit_logs_created;

-- 4. home_seen_items: dead rotation index
DROP INDEX IF EXISTS idx_home_seen_items_rotation;

-- 5. shipping_item_types: 2 dead indexes
DROP INDEX IF EXISTS idx_shipping_types_active;
DROP INDEX IF EXISTS idx_shipping_types_active_priority;
