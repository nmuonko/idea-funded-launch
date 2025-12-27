-- =========================================
-- FIX REMAINING SECURITY ISSUES
-- =========================================

-- 1. FIX: product_hot_cache - drop existing and recreate
DROP POLICY IF EXISTS "Authenticated users can read hot cache" ON public.product_hot_cache;
DROP POLICY IF EXISTS "Service role can manage hot cache" ON public.product_hot_cache;

CREATE POLICY "Authenticated users can read hot cache"
ON public.product_hot_cache
FOR SELECT
USING (auth.uid() IS NOT NULL);

CREATE POLICY "Service role can manage hot cache"
ON public.product_hot_cache
FOR ALL
USING (true)
WITH CHECK (true);

-- 2. FIX: price_cache - drop and recreate
DROP POLICY IF EXISTS "Authenticated users can read price cache" ON public.price_cache;
DROP POLICY IF EXISTS "Service role can manage price cache" ON public.price_cache;

CREATE POLICY "Authenticated users can read price cache"
ON public.price_cache
FOR SELECT
USING (auth.uid() IS NOT NULL);

CREATE POLICY "Service role can manage price cache"
ON public.price_cache
FOR ALL
USING (true)
WITH CHECK (true);

-- 3. FIX: product_cache - drop and recreate
DROP POLICY IF EXISTS "Authenticated users can read product cache" ON public.product_cache;
DROP POLICY IF EXISTS "Service role can manage product cache" ON public.product_cache;

CREATE POLICY "Authenticated users can read product cache"
ON public.product_cache
FOR SELECT
USING (auth.uid() IS NOT NULL);

CREATE POLICY "Service role can manage product cache"
ON public.product_cache
FOR ALL
USING (true)
WITH CHECK (true);