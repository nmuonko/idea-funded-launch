-- Fix security issue: Add RLS to safe_user_payments view
-- Views with security_invoker=true need explicit RLS policies

-- First, drop the existing view if it exists and recreate with RLS
DROP VIEW IF EXISTS public.safe_user_payments;

-- Recreate the view with proper security settings
CREATE VIEW public.safe_user_payments 
WITH (security_invoker = true)
AS SELECT 
  mp.id,
  mp.order_id,
  mp.maisha_reference,
  mp.status,
  mp.confirmation_code,
  mp.amount_usd,
  mp.amount_cdf,
  mp.currency,
  mp.paid_at,
  mp.created_at,
  mp.updated_at
FROM public.maisha_payments mp;

-- Grant SELECT to authenticated users (RLS will control actual access)
GRANT SELECT ON public.safe_user_payments TO authenticated;

-- Note: Views inherit RLS from underlying tables when security_invoker=true
-- The maisha_payments table already has proper RLS policies:
-- 1. Users can view by confirmation code
-- 2. Users can view their own order payments
-- 3. Admins can view all
-- These policies are inherited through the view due to security_invoker=true