-- Remove is_email_verified() check from RLS policies on orders, checkout_sessions, payment_attempts

-- 1. Drop and recreate orders INSERT policy
DROP POLICY IF EXISTS "Users can insert their own orders" ON public.orders;
CREATE POLICY "Users can insert their own orders"
ON public.orders FOR INSERT TO authenticated
WITH CHECK (auth.uid() = user_id);

-- 2. Drop and recreate checkout_sessions INSERT policy
DROP POLICY IF EXISTS "Users can insert their own checkout sessions" ON public.checkout_sessions;
CREATE POLICY "Users can insert their own checkout sessions"
ON public.checkout_sessions FOR INSERT TO authenticated
WITH CHECK (auth.uid() = user_id);

-- 3. Drop and recreate payment_attempts INSERT policy
DROP POLICY IF EXISTS "Users can insert their own payment attempts" ON public.payment_attempts;
CREATE POLICY "Users can insert their own payment attempts"
ON public.payment_attempts FOR INSERT TO authenticated
WITH CHECK (true);