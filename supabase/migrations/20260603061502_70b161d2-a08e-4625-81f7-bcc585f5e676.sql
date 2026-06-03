-- Track when a payment retry reminder email was sent for an auto-expired order
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS payment_retry_email_sent_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_orders_retry_email_pending
  ON public.orders (updated_at)
  WHERE status = 'CANCELLED'
    AND cancel_reason = 'auto_expired_no_payment'
    AND payment_retry_email_sent_at IS NULL;
