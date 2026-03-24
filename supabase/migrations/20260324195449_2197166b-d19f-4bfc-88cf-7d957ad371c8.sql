CREATE POLICY "Anyone can lookup referrers by email"
ON public.referrers
FOR SELECT
TO anon, authenticated
USING (true);