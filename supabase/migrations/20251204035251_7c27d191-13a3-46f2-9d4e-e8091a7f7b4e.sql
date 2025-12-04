-- Fix security definer view by making it SECURITY INVOKER
DROP VIEW IF EXISTS public.safe_user_payments;

-- Recreate view with SECURITY INVOKER (default, but explicit is better)
CREATE VIEW public.safe_user_payments 
WITH (security_invoker = true) AS
SELECT 
  mp.id,
  mp.order_id,
  mp.maisha_reference,
  mp.amount_usd,
  mp.amount_cdf,
  mp.currency,
  mp.status,
  mp.paid_at,
  mp.created_at,
  mp.updated_at
FROM maisha_payments mp
INNER JOIN orders o ON o.id = mp.order_id
WHERE o.user_id = auth.uid();

GRANT SELECT ON public.safe_user_payments TO authenticated;