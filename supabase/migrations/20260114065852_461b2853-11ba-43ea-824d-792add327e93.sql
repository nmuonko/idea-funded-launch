-- Production Readiness Optimization Migration (Fixed)

-- =====================================================
-- Phase 1: Index Cleanup (Remove unused/redundant indexes)
-- =====================================================

-- Drop redundant profile indexes (skip profiles_user_id_unique - it's a constraint)
DROP INDEX IF EXISTS idx_profiles_user_id;
DROP INDEX IF EXISTS idx_profiles_language;
DROP INDEX IF EXISTS idx_profiles_country;
DROP INDEX IF EXISTS idx_profiles_email;

-- Drop unused order indexes (covered by other composite indexes)
DROP INDEX IF EXISTS idx_orders_maisha_transaction_id;
DROP INDEX IF EXISTS idx_orders_contains_vehicle;
DROP INDEX IF EXISTS idx_orders_pending_payment;

-- Drop unused user_roles indexes (user_roles_pkey covers lookups)
DROP INDEX IF EXISTS idx_user_roles_admin;
DROP INDEX IF EXISTS idx_user_roles_user_id;
DROP INDEX IF EXISTS idx_user_roles_user_role;

-- =====================================================
-- Phase 2: Add Performance Indexes
-- =====================================================

-- Optimize maisha_payments lookups for payment verification
CREATE INDEX IF NOT EXISTS idx_maisha_payments_order_status 
ON maisha_payments(order_id, status);

-- Optimize payment_providers active provider lookup (partial index)
CREATE INDEX IF NOT EXISTS idx_payment_providers_enabled_priority 
ON payment_providers(is_enabled, priority) WHERE is_enabled = true;

-- =====================================================
-- Phase 3: Public Config Function (SECURITY DEFINER)
-- =====================================================

-- Create optimized function for public config access
CREATE OR REPLACE FUNCTION public.get_public_config()
RETURNS TABLE(
  exchange_rate numeric,
  markup_percent numeric,
  shipping_base_fee numeric,
  shipping_percent numeric,
  maishapay_max_usd numeric,
  maishapay_max_cdf numeric
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT 
    exchange_rate_usd_to_cdf,
    COALESCE(markup_percent, global_markup_percent, 15),
    shipping_base_fee_usd,
    shipping_percent,
    maishapay_max_usd,
    maishapay_max_cdf
  FROM settings 
  LIMIT 1;
$$;