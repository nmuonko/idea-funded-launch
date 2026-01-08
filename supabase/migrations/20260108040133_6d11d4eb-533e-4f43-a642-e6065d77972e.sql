-- Fix function search path for get_store_cache_ttl
CREATE OR REPLACE FUNCTION public.get_store_cache_ttl(store_input text)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE 
    WHEN store_input IN ('amazon', 'alibaba', 'aliexpress') THEN 7200   -- 2 hours for major stores
    WHEN store_input IN ('ebay', 'walmart') THEN 3600                   -- 1 hour for dynamic pricing
    ELSE 10800                                                          -- 3 hours default
  END;
$$;

-- Fix RLS policies that use USING(true) for service-role access
-- These tables should only be accessed by service role (edge functions), not directly by users

-- admin_audit_logs: Service role insert only
DROP POLICY IF EXISTS "Service role can insert audit logs" ON public.admin_audit_logs;
CREATE POLICY "Service role can insert audit logs" 
ON public.admin_audit_logs 
FOR INSERT 
TO service_role
WITH CHECK (true);

-- ai_action_queue: Service role insert only
DROP POLICY IF EXISTS "Service role can insert AI actions" ON public.ai_action_queue;
CREATE POLICY "Service role can insert AI actions" 
ON public.ai_action_queue 
FOR INSERT 
TO service_role
WITH CHECK (true);

-- cart_recovery_predictions: Service role all operations
DROP POLICY IF EXISTS "Service role can manage predictions" ON public.cart_recovery_predictions;
CREATE POLICY "Service role can manage predictions" 
ON public.cart_recovery_predictions 
FOR ALL 
TO service_role
USING (true)
WITH CHECK (true);

-- checkout_sessions: Service role all operations
DROP POLICY IF EXISTS "Service role can manage all checkout sessions" ON public.checkout_sessions;
CREATE POLICY "Service role can manage all checkout sessions" 
ON public.checkout_sessions 
FOR ALL 
TO service_role
USING (true)
WITH CHECK (true);

-- performance_metrics: Service role insert only
DROP POLICY IF EXISTS "Allow insert metrics" ON public.performance_metrics;
CREATE POLICY "Service role can insert metrics" 
ON public.performance_metrics 
FOR INSERT 
TO service_role
WITH CHECK (true);

-- price_history: Service role insert only
DROP POLICY IF EXISTS "Service role can insert history" ON public.price_history;
CREATE POLICY "Service role can insert history" 
ON public.price_history 
FOR INSERT 
TO service_role
WITH CHECK (true);

-- product_recommendations: Service role all operations
DROP POLICY IF EXISTS "Service role can manage recommendations" ON public.product_recommendations;
CREATE POLICY "Service role can manage recommendations" 
ON public.product_recommendations 
FOR ALL 
TO service_role
USING (true)
WITH CHECK (true);

-- quote_requests: Service role insert only
DROP POLICY IF EXISTS "Service role can insert quote requests" ON public.quote_requests;
CREATE POLICY "Service role can insert quote requests" 
ON public.quote_requests 
FOR INSERT 
TO service_role
WITH CHECK (true);

-- rate_limits: Service role all operations
DROP POLICY IF EXISTS "Service role only for rate limits" ON public.rate_limits;
CREATE POLICY "Service role only for rate limits" 
ON public.rate_limits 
FOR ALL 
TO service_role
USING (true)
WITH CHECK (true);

-- recommendation_clicks: Service role all operations
DROP POLICY IF EXISTS "Service role can manage clicks" ON public.recommendation_clicks;
CREATE POLICY "Service role can manage clicks" 
ON public.recommendation_clicks 
FOR ALL 
TO service_role
USING (true)
WITH CHECK (true);

-- price_capture_cache: Fix the update policy to require authenticated + conditions
DROP POLICY IF EXISTS "Authenticated users can update high-confidence prices" ON public.price_capture_cache;
CREATE POLICY "Authenticated users can update high-confidence prices" 
ON public.price_capture_cache 
FOR UPDATE 
TO authenticated
USING (
  (source = 'tap' OR (source = 'auto' AND confidence >= 0.85) OR (source = 'manual' AND confidence >= 0.95))
)
WITH CHECK (
  (source = 'tap' OR (source = 'auto' AND confidence >= 0.85) OR (source = 'manual' AND confidence >= 0.95))
);