CREATE POLICY "Public can view sent campaigns"
ON public.hot_product_campaigns
FOR SELECT
TO anon, authenticated
USING (status = 'sent');