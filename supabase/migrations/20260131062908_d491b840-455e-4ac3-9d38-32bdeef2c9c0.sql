-- Performance indexes for frequently accessed tables
-- These indexes address high sequential scan rates identified in performance audit

-- admin_settings: Queried 30+ times per home request
CREATE INDEX IF NOT EXISTS idx_admin_settings_key ON admin_settings(key);

-- profiles: High seq_scan count (491k vs 8k idx)
CREATE INDEX IF NOT EXISTS idx_profiles_user_id ON profiles(user_id);
CREATE INDEX IF NOT EXISTS idx_profiles_email ON profiles(email);

-- orders: Frequently queried by status (570k seq scans)
CREATE INDEX IF NOT EXISTS idx_orders_status_created ON orders(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_user_id_status ON orders(user_id, status);

-- order_items: High seq_scan count (478k)
CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id);

-- user_roles: Critical for admin checks (855k seq scans)
CREATE INDEX IF NOT EXISTS idx_user_roles_user_id_role ON user_roles(user_id, role);

-- catalog_cache: Frequently queried by cache_key
CREATE INDEX IF NOT EXISTS idx_catalog_cache_key_expires ON catalog_cache(cache_key, expires_at DESC);

-- provider_budget: Queried on every Amazon API call
CREATE INDEX IF NOT EXISTS idx_provider_budget_window_key ON provider_budget(window_key);

-- catalog_items: Search and category browsing
CREATE INDEX IF NOT EXISTS idx_catalog_items_provider_category ON catalog_items(provider, category_key);
CREATE INDEX IF NOT EXISTS idx_catalog_items_unified_category ON catalog_items(unified_category, updated_at DESC);