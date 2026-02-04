-- Add RESTRICTIVE anonymous block policies to critical tables missing them
-- This matches the hardening pattern already used on profiles, orders, admin_users

-- 1. Block anonymous access on admin_invitations
CREATE POLICY "Block anonymous access on admin_invitations"
ON public.admin_invitations
AS RESTRICTIVE
FOR ALL
USING (auth.uid() IS NOT NULL);

-- 2. Block anonymous access on maisha_payments
CREATE POLICY "Block anonymous access on maisha_payments"
ON public.maisha_payments
AS RESTRICTIVE
FOR ALL
USING (auth.uid() IS NOT NULL);

-- 3. Block anonymous access on customer_email_logs
CREATE POLICY "Block anonymous access on customer_email_logs"
ON public.customer_email_logs
AS RESTRICTIVE
FOR ALL
USING (auth.uid() IS NOT NULL);