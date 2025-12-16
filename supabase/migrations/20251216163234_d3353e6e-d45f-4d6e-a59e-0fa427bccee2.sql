-- Update safe_user_payments view to include confirmation_code for order tracking
-- This allows users to look up orders by confirmation code without accessing sensitive raw API data

DROP VIEW IF EXISTS public.safe_user_payments;

CREATE VIEW public.safe_user_payments AS
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
  confirmation_code  -- Added for order tracking functionality
FROM maisha_payments;

-- Grant select on view to authenticated users
GRANT SELECT ON public.safe_user_payments TO authenticated;

COMMENT ON VIEW public.safe_user_payments IS 'Safe view of maisha_payments that excludes sensitive raw_request and raw_response JSONB fields';