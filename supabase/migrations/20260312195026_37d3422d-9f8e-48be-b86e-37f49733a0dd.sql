-- Fix hot_product_campaigns RLS: use canonical role function instead of legacy admin_users ID check
DROP POLICY IF EXISTS "Admins can manage hot_product_campaigns" ON public.hot_product_campaigns;

CREATE POLICY "Admins can manage hot_product_campaigns"
ON public.hot_product_campaigns
FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'admin'::public.app_role))
WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));