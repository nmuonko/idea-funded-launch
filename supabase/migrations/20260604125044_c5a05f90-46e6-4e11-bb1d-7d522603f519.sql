
-- Fix maisha_payments: revoke table-wide SELECT, grant only safe columns
REVOKE SELECT ON public.maisha_payments FROM anon, authenticated;
GRANT SELECT (
  id, order_id, maisha_reference, status, amount_usd, amount_cdf, currency,
  paid_at, created_at, updated_at, confirmation_code, maishapay_status,
  maishapay_description, maishapay_transaction_ref_id, maishapay_operator_ref_id, user_id
) ON public.maisha_payments TO authenticated;

-- Add explicit service_role bypass policy on catalog_refresh_queue
DROP POLICY IF EXISTS "Service role full access on catalog_refresh_queue" ON public.catalog_refresh_queue;
CREATE POLICY "Service role full access on catalog_refresh_queue"
  ON public.catalog_refresh_queue
  AS PERMISSIVE
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Add explicit service_role bypass policy on search_query_log
DROP POLICY IF EXISTS "Service role full access on search_query_log" ON public.search_query_log;
CREATE POLICY "Service role full access on search_query_log"
  ON public.search_query_log
  AS PERMISSIVE
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
