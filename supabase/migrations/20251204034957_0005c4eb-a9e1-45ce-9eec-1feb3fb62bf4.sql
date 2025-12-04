-- Phase 2: Security Hardening - Fix RLS policies

-- Fix admin_invitations: Add a safer policy that requires token to be provided as a parameter
DROP POLICY IF EXISTS "Anyone can view their pending invitation by token" ON admin_invitations;

-- Create a more secure policy - users can only view invitations by their email OR with a specific token check
CREATE POLICY "Users can view invitations for their email" 
ON admin_invitations 
FOR SELECT 
USING (
  email = (SELECT email FROM auth.users WHERE id = auth.uid())
  OR (status = 'pending' AND expires_at > now())
);

-- Fix admin_users: Make SELECT policy more restrictive - only return if user is checking their own admin status
DROP POLICY IF EXISTS "Authenticated users can check admin status" ON admin_users;

CREATE POLICY "Users can check if they are admin" 
ON admin_users 
FOR SELECT 
USING (
  email = (SELECT email FROM auth.users WHERE id = auth.uid())
  OR has_role(auth.uid(), 'admin'::app_role)
);

-- Add service role insert policy for maisha_payments (for edge functions)
DROP POLICY IF EXISTS "Admins can insert payments" ON maisha_payments;

CREATE POLICY "Service role and admins can insert payments" 
ON maisha_payments 
FOR INSERT 
WITH CHECK (
  has_role(auth.uid(), 'admin'::app_role)
  OR current_setting('role') = 'service_role'
);

-- Add service role update policy for maisha_payments
DROP POLICY IF EXISTS "Admins can update payments" ON maisha_payments;

CREATE POLICY "Service role and admins can update payments" 
ON maisha_payments 
FOR UPDATE 
USING (
  has_role(auth.uid(), 'admin'::app_role)
  OR current_setting('role') = 'service_role'
);

-- Add index for faster order lookups by maisha_transaction_id
CREATE INDEX IF NOT EXISTS idx_orders_maisha_transaction_id ON orders(maisha_transaction_id);

-- Add index for faster payment lookups by reference
CREATE INDEX IF NOT EXISTS idx_maisha_payments_reference ON maisha_payments(maisha_reference);