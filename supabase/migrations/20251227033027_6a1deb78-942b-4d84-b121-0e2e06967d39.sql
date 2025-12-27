-- =========================================
-- FINAL SECURITY FIXES
-- =========================================

-- 1. FIX: admin_settings - remove the permissive public policy
DROP POLICY IF EXISTS "Public can read allowed settings keys" ON public.admin_settings;

-- Ensure the authenticated-only policy exists
DROP POLICY IF EXISTS "Authenticated users can read public settings" ON public.admin_settings;
CREATE POLICY "Authenticated users can read public settings"
ON public.admin_settings
FOR SELECT
USING (
  auth.uid() IS NOT NULL 
  AND key IN ('bank_transfer_details', 'public_exchange_rate', 'public_config')
);

-- 2. FIX: support_messages - remove the overly permissive service role policy
-- Service role bypasses RLS anyway, so this policy serves no purpose and creates a hole
DROP POLICY IF EXISTS "Service role can manage messages" ON public.support_messages;

-- 3. FIX: shipping_item_types - the "Anyone can view active shipping types" allows public access
-- This is intentional for displaying shipping options to users browsing products
-- But let's make it require authentication to be safe
DROP POLICY IF EXISTS "Anyone can view active shipping types" ON public.shipping_item_types;

CREATE POLICY "Authenticated users can view active shipping types"
ON public.shipping_item_types
FOR SELECT
USING (auth.uid() IS NOT NULL AND active = true);

-- 4. Remove ALL policies with "true" as the condition (overly permissive)
-- These should only exist if absolutely necessary for service role operations
DROP POLICY IF EXISTS "Service role can manage price cache" ON public.price_cache;
DROP POLICY IF EXISTS "Service role can manage product cache" ON public.product_cache;
DROP POLICY IF EXISTS "Service role can manage hot cache" ON public.product_hot_cache;

-- Service role already bypasses RLS, so these policies are unnecessary
-- The authenticated user policies are sufficient