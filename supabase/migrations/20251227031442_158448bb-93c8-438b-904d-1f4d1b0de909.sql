-- bank_transfer_view_tokens should ONLY be accessible via service role
-- Adding a deny-all policy that allows service role (which bypasses RLS) but blocks all other access
CREATE POLICY "No public access - service role only"
ON public.bank_transfer_view_tokens
FOR ALL
USING (false)
WITH CHECK (false);