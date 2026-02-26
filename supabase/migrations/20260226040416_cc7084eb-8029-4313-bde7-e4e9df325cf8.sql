
-- =====================================================
-- Round 4: Dead Index Cleanup on High-Write Tables
-- =====================================================

-- order_items: 5 dead indexes
DROP INDEX IF EXISTS idx_order_items_store;
DROP INDEX IF EXISTS idx_order_items_saved_partial;
DROP INDEX IF EXISTS idx_order_items_manual_quote;
DROP INDEX IF EXISTS idx_order_items_is_vehicle;
DROP INDEX IF EXISTS idx_order_items_device_id;

-- orders: 2 dead indexes
DROP INDEX IF EXISTS idx_orders_payment_email_pending;
DROP INDEX IF EXISTS idx_orders_user_draft;

-- maisha_payments: 7 dead indexes (skip pkey + unique constraints)
DROP INDEX IF EXISTS idx_maisha_payments_user_order;
DROP INDEX IF EXISTS idx_maisha_payments_confirmation_code;
DROP INDEX IF EXISTS idx_maisha_payments_transaction_ref;
DROP INDEX IF EXISTS idx_maisha_payments_order_status;
DROP INDEX IF EXISTS idx_maisha_payments_order;
DROP INDEX IF EXISTS idx_maisha_payments_maisha_reference;
DROP INDEX IF EXISTS idx_maisha_payments_reference;

-- checkout_sessions: 3 dead indexes
DROP INDEX IF EXISTS idx_checkout_sessions_order_id;
DROP INDEX IF EXISTS idx_checkout_sessions_maisha_reference;
DROP INDEX IF EXISTS idx_checkout_sessions_maisha_ref;

-- payment_attempts: 3 dead indexes
DROP INDEX IF EXISTS idx_payment_attempts_cart_hash;
DROP INDEX IF EXISTS idx_payment_attempts_status;
DROP INDEX IF EXISTS idx_payment_attempts_created;

-- payments: 3 dead indexes
DROP INDEX IF EXISTS idx_payments_reference;
DROP INDEX IF EXISTS idx_payments_status;
DROP INDEX IF EXISTS idx_payments_status_lookup;

-- user_roles: 2 dead indexes
DROP INDEX IF EXISTS idx_user_roles_rls_optimized;
DROP INDEX IF EXISTS idx_user_roles_user_lookup;
