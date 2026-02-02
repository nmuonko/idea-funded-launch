-- Fix: Payment Confirmation Codes Accessible Without User Verification
-- Drop the vulnerable policy that checks confirmation_code before user ownership
DROP POLICY IF EXISTS "Users can view payments by confirmation code" ON public.maisha_payments;

-- Create improved policy that checks user ownership FIRST
-- This prevents timing attacks and ensures user_id is validated before any confirmation_code lookup
CREATE POLICY "Users can view their own payments"
ON public.maisha_payments
FOR SELECT
USING (
  -- Check user ownership FIRST (direct match or via order ownership)
  user_id = auth.uid() OR
  EXISTS (
    SELECT 1 FROM orders 
    WHERE orders.id = maisha_payments.order_id 
    AND orders.user_id = auth.uid()
  )
);

-- Note: confirmation_code lookups are now only possible if the user already owns the payment
-- This eliminates timing attacks since user_id check happens before any code comparison