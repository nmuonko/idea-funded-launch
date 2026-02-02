-- Add RESTRICTIVE policy to block anonymous access on orders table
-- This matches the pattern used on profiles table for defense in depth

CREATE POLICY "Block anonymous access on orders"
ON public.orders
AS RESTRICTIVE
FOR ALL
TO public
USING (auth.uid() IS NOT NULL);