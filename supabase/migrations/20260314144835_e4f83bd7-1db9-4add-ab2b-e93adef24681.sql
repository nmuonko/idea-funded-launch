-- Fix 1: Drop restrictive RLS policies that require email verification
DROP POLICY IF EXISTS "Users can create payment attempts" ON public.payment_attempts;
DROP POLICY IF EXISTS "Users can create their own checkout sessions" ON public.checkout_sessions;

-- Fix 2: Add UPDATE policy for payment_attempts
CREATE POLICY "Users can update their own payment attempts"
ON public.payment_attempts
FOR UPDATE
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- Fix 3: Add INSERT policy for payments table
CREATE POLICY "Users can insert payments for their orders"
ON public.payments
FOR INSERT
TO authenticated
WITH CHECK (EXISTS (
  SELECT 1 FROM orders WHERE orders.id = order_id AND orders.user_id = auth.uid()
));

-- Fix 4: Add UPDATE policy for payments table (for service role / webhooks)
CREATE POLICY "Service role can update payments"
ON public.payments
FOR UPDATE
TO service_role
USING (true)
WITH CHECK (true);