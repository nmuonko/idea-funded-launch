-- Drop the MaishaPay-related safe_user_payments view since MaishaPay is deprecated
DROP VIEW IF EXISTS public.safe_user_payments CASCADE;

-- Create a new safe_user_payments view based on the payments table (used by pawaPay/Stripe)
CREATE VIEW public.safe_user_payments 
WITH (security_invoker = true)
AS SELECT 
  p.id,
  p.order_id,
  p.reference,
  p.provider_key,
  p.status,
  p.amount,
  p.currency,
  p.paid_at,
  p.created_at,
  p.updated_at
FROM public.payments p
WHERE EXISTS (
  SELECT 1 FROM public.orders o 
  WHERE o.id = p.order_id 
  AND o.user_id = auth.uid()
);

-- Grant SELECT to authenticated users (RLS inherited from underlying tables)
GRANT SELECT ON public.safe_user_payments TO authenticated;

COMMENT ON VIEW public.safe_user_payments IS 'Safe view for users to see their own payment records. Uses security_invoker to respect underlying RLS.';