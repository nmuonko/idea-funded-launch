
-- =============================================================================
-- DB STABILITY & PERFORMANCE AUDIT FIX (10k+ Users) - Phase 2
-- =============================================================================
-- Addresses remaining performance bottlenecks. 15 new indexes across 12 tables.
-- =============================================================================

-- A. shipping_item_types - 295k seq scans (column is "active" not "is_active")
CREATE INDEX IF NOT EXISTS idx_shipping_types_active_priority 
ON public.shipping_item_types (active, key) 
WHERE active = true;

-- B. payment_providers - 15k seq scans
CREATE INDEX IF NOT EXISTS idx_payment_providers_default 
ON public.payment_providers (is_default) 
WHERE is_default = true;

-- C. maisha_payments - 81k seq scans (critical for payment flows)
CREATE INDEX IF NOT EXISTS idx_maisha_payments_user_order 
ON public.maisha_payments (user_id, order_id);

CREATE INDEX IF NOT EXISTS idx_maisha_payments_reference 
ON public.maisha_payments (maisha_reference);

-- D. payment_settings - singleton optimization
CREATE INDEX IF NOT EXISTS idx_payment_settings_singleton 
ON public.payment_settings (id);

-- E. bank_transfer_settings - singleton optimization  
CREATE INDEX IF NOT EXISTS idx_bank_transfer_singleton 
ON public.bank_transfer_settings (id);

-- F. catalog_providers - enabled status lookups
CREATE INDEX IF NOT EXISTS idx_catalog_providers_enabled 
ON public.catalog_providers (enabled, priority) 
WHERE enabled = true;

-- G. catalog_categories - enabled + slug lookups
CREATE INDEX IF NOT EXISTS idx_catalog_categories_enabled_slug 
ON public.catalog_categories (enabled, slug) 
WHERE enabled = true;

-- H. admin_user_permissions - RLS covering index
CREATE INDEX IF NOT EXISTS idx_admin_permissions_user_full 
ON public.admin_user_permissions (user_id) INCLUDE (can_view_customers, can_manage_users);

-- I. price_cache - store + url lookup (correct column: url not product_key)
CREATE INDEX IF NOT EXISTS idx_price_cache_store_url 
ON public.price_cache (store, url);

-- J. checkout_sessions - payment flows
CREATE INDEX IF NOT EXISTS idx_checkout_sessions_user_status 
ON public.checkout_sessions (user_id, status);

CREATE INDEX IF NOT EXISTS idx_checkout_sessions_order_lookup 
ON public.checkout_sessions (order_id) 
WHERE order_id IS NOT NULL;

-- K. catalog_products - provider lookups
CREATE INDEX IF NOT EXISTS idx_catalog_products_provider_id_lookup 
ON public.catalog_products (provider_id, provider_product_id);

-- L. Partial index for pending payment orders (hot path)
CREATE INDEX IF NOT EXISTS idx_orders_pending_payment 
ON public.orders (user_id, created_at DESC) 
WHERE status = 'PENDING_PAYMENT';

-- M. Cart totals covering index (eliminates row fetches)
CREATE INDEX IF NOT EXISTS idx_order_items_cart_totals 
ON public.order_items (order_id, is_saved_for_later) 
INCLUDE (base_price_usd, markup_fee_usd, shipping_fee_usd, total_price_usd, quantity);

-- N. Force statistics update
ANALYZE public.user_roles;
ANALYZE public.profiles;
ANALYZE public.orders;
ANALYZE public.order_items;
ANALYZE public.settings;
ANALYZE public.admin_settings;
ANALYZE public.catalog_items;
ANALYZE public.catalog_cache;
ANALYZE public.shipping_item_types;
ANALYZE public.payment_providers;
ANALYZE public.maisha_payments;
