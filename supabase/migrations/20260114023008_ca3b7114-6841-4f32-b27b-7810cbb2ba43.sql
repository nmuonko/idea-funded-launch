-- Fix 1: Restrict payment_providers to authenticated users only
-- This prevents unauthenticated users from seeing secret_refs (env var names)

DROP POLICY IF EXISTS "Anyone can view enabled payment providers" ON payment_providers;

CREATE POLICY "Authenticated users can view enabled providers"
ON payment_providers FOR SELECT
TO authenticated
USING (is_enabled = true);

-- Fix 2: Allow users to view their own manual transfer sessions
-- This enables customers to use the manual bank transfer payment flow

CREATE POLICY "Users can view their own manual transfer sessions"
ON manual_transfer_sessions FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM orders
    WHERE orders.id = manual_transfer_sessions.order_id
    AND orders.user_id = auth.uid()
  )
);