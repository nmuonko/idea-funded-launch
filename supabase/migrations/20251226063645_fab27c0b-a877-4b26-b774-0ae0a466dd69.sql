-- Fix the performance_metrics table to allow service role inserts properly
-- Drop existing policies and recreate with proper permissions
DROP POLICY IF EXISTS "Service role can insert metrics" ON public.performance_metrics;

-- Allow all inserts (edge functions use service role which bypasses RLS anyway)
-- This policy is for completeness
CREATE POLICY "Allow insert metrics"
ON public.performance_metrics
FOR INSERT
WITH CHECK (true);

-- Allow admins full access
DROP POLICY IF EXISTS "Admins can view performance metrics" ON public.performance_metrics;
CREATE POLICY "Admins can manage performance metrics"
ON public.performance_metrics
FOR ALL
USING (public.has_role(auth.uid(), 'admin'));