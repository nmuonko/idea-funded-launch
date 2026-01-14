-- Pre-launch optimization migration

-- 1. Restrict price_capture_cache to authenticated users only
-- (Product price cache - no user ownership, but shouldn't be public)
DROP POLICY IF EXISTS "Anyone can view price cache" ON price_capture_cache;
DROP POLICY IF EXISTS "Public read access" ON price_capture_cache;

CREATE POLICY "Authenticated users can view price cache"
ON price_capture_cache FOR SELECT
TO authenticated
USING (true);

-- 2. Restrict price_history to service_role only (admin/backend use only)
DROP POLICY IF EXISTS "Anyone can view price history" ON price_history;
DROP POLICY IF EXISTS "Public read access" ON price_history;

CREATE POLICY "Service role only for price history"
ON price_history FOR SELECT
TO service_role
USING (true);

-- 3. Add missing index on profiles for faster user lookups
CREATE INDEX IF NOT EXISTS idx_profiles_user_id ON profiles(user_id);

-- 4. Remove duplicate order index (keep the original idx_orders_user_status)
DROP INDEX IF EXISTS idx_orders_user_status_composite;