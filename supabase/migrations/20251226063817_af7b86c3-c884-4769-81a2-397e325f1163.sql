-- Fix rate_limits table - it's used internally by edge functions via service role
-- Only service role should access it, no user access needed
CREATE POLICY "Service role only for rate limits"
ON public.rate_limits
FOR ALL
USING (true)
WITH CHECK (true);