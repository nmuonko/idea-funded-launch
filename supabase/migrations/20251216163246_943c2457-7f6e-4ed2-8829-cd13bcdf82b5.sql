-- Fix security definer view warning by explicitly setting SECURITY INVOKER
-- This ensures RLS policies of the querying user are enforced, not the view creator

DROP VIEW IF EXISTS public.safe_user_payments;

CREATE VIEW public.safe_user_payments 
WITH (security_invoker = true) AS
SELECT 
  id,
  order_id,
  amount_usd,
  amount_cdf,
  paid_at,
  created_at,
  updated_at,
  maisha_reference,
  currency,
  status,
  confirmation_code
FROM maisha_payments;

GRANT SELECT ON public.safe_user_payments TO authenticated;

COMMENT ON VIEW public.safe_user_payments IS 'Safe view of maisha_payments that excludes sensitive raw_request and raw_response JSONB fields. Uses SECURITY INVOKER to respect querying users RLS policies.';