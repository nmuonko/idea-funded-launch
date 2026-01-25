-- Add payment_confirmation_email_sent_at to orders table for idempotent email sending
ALTER TABLE public.orders 
  ADD COLUMN IF NOT EXISTS payment_confirmation_email_sent_at TIMESTAMPTZ;

-- Add index for efficient lookup of orders needing emails
CREATE INDEX IF NOT EXISTS idx_orders_payment_email_pending 
  ON public.orders (status) 
  WHERE status = 'PAID' AND payment_confirmation_email_sent_at IS NULL;

-- Add comment for documentation
COMMENT ON COLUMN public.orders.payment_confirmation_email_sent_at IS 
  'Timestamp when payment confirmation email was sent. Used for idempotent email sending.';