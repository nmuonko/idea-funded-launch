-- Auto-expire stale PENDING_PAYMENT orders to stop "En attente" bloat

CREATE OR REPLACE FUNCTION public.expire_stale_pending_orders()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  cnt integer;
BEGIN
  WITH expired AS (
    UPDATE public.orders o
       SET status = 'CANCELLED'::order_status,
           cancel_reason = COALESCE(o.cancel_reason, 'auto_expired_no_payment'),
           updated_at = now()
     WHERE o.status = 'PENDING_PAYMENT'::order_status
       AND o.created_at < now() - interval '30 minutes'
       AND NOT EXISTS (
         SELECT 1
           FROM public.payments p
          WHERE p.order_id = o.id
            AND p.status IN ('completed','succeeded','paid','COMPLETED','SUCCEEDED','PAID')
       )
       AND NOT EXISTS (
         SELECT 1
           FROM public.payment_attempts pa
          WHERE pa.order_id = o.id
            AND pa.status IN ('completed','succeeded','paid','COMPLETED','SUCCEEDED','PAID')
       )
     RETURNING o.id
  )
  SELECT count(*) INTO cnt FROM expired;
  RETURN cnt;
END;
$$;

REVOKE ALL ON FUNCTION public.expire_stale_pending_orders() FROM public;
GRANT EXECUTE ON FUNCTION public.expire_stale_pending_orders() TO service_role;

-- Schedule the cleanup every 5 minutes via pg_cron (idempotent)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'expire-stale-pending-orders') THEN
    PERFORM cron.unschedule('expire-stale-pending-orders');
  END IF;
  PERFORM cron.schedule(
    'expire-stale-pending-orders',
    '*/5 * * * *',
    $cron$SELECT public.expire_stale_pending_orders();$cron$
  );
END
$$;

-- Helpful index for the cleanup query
CREATE INDEX IF NOT EXISTS idx_orders_status_created_at
  ON public.orders (status, created_at)
  WHERE status = 'PENDING_PAYMENT';
