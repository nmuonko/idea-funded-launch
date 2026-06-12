
-- 1. customer_email_logs: restrict to admins with can_view_customers or can_manage_users
DROP POLICY IF EXISTS "Admins can manage email logs" ON public.customer_email_logs;
CREATE POLICY "Admins with customer permission can view email logs"
ON public.customer_email_logs FOR SELECT
USING (
  is_admin(auth.uid())
  AND (
    admin_has_permission(auth.uid(), 'can_view_customers')
    OR admin_has_permission(auth.uid(), 'can_manage_users')
  )
);
CREATE POLICY "Admins with manage permission can modify email logs"
ON public.customer_email_logs FOR INSERT
WITH CHECK (
  is_admin(auth.uid())
  AND admin_has_permission(auth.uid(), 'can_manage_users')
);
CREATE POLICY "Admins with manage permission can update email logs"
ON public.customer_email_logs FOR UPDATE
USING (is_admin(auth.uid()) AND admin_has_permission(auth.uid(), 'can_manage_users'))
WITH CHECK (is_admin(auth.uid()) AND admin_has_permission(auth.uid(), 'can_manage_users'));
CREATE POLICY "Admins with manage permission can delete email logs"
ON public.customer_email_logs FOR DELETE
USING (is_admin(auth.uid()) AND admin_has_permission(auth.uid(), 'can_manage_users'));

-- 2. hot_product_campaigns: remove public read of sent campaigns (no client code uses it; service role still has access)
DROP POLICY IF EXISTS "Public can view sent campaigns" ON public.hot_product_campaigns;

-- 3. payments: restrict user INSERT to safe columns via trigger that scrubs server-only fields
CREATE OR REPLACE FUNCTION public.scrub_payment_user_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- If insert is performed by an authenticated end-user (not service_role/admin),
  -- strip out fields that should only be populated server-side.
  IF auth.uid() IS NOT NULL AND NOT has_role(auth.uid(), 'admin'::app_role) THEN
    NEW.client_secret := NULL;
    NEW.customer_phone := NULL;
    NEW.status := COALESCE(NEW.status, 'pending');
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS scrub_payment_user_insert_trg ON public.payments;
CREATE TRIGGER scrub_payment_user_insert_trg
BEFORE INSERT ON public.payments
FOR EACH ROW EXECUTE FUNCTION public.scrub_payment_user_insert();

-- 4. price_confirmations: prevent anon (null user_id) inserts
DROP POLICY IF EXISTS "Users can insert own price confirmations" ON public.price_confirmations;
CREATE POLICY "Users can insert own price confirmations"
ON public.price_confirmations FOR INSERT
WITH CHECK (auth.uid() IS NOT NULL AND auth.uid() = user_id);
