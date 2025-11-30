-- Fix RLS policy to allow users to transition their orders from DRAFT to PENDING_PAYMENT
DROP POLICY IF EXISTS "Users can update their own draft orders" ON orders;

CREATE POLICY "Users can update their own draft orders"
ON orders
FOR UPDATE
TO authenticated
USING (auth.uid() = user_id AND status = 'DRAFT'::order_status)
WITH CHECK (
  auth.uid() = user_id 
  AND (status = 'DRAFT'::order_status OR status = 'PENDING_PAYMENT'::order_status)
);