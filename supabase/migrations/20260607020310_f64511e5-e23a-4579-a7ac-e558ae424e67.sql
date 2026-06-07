-- Add 30% deposit / 70% balance payment plan support to orders (additive only)
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS payment_plan text NOT NULL DEFAULT 'full',
  ADD COLUMN IF NOT EXISTS deposit_amount_usd numeric(10,2),
  ADD COLUMN IF NOT EXISTS balance_amount_usd numeric(10,2),
  ADD COLUMN IF NOT EXISTS balance_status text NOT NULL DEFAULT 'not_applicable',
  ADD COLUMN IF NOT EXISTS balance_paid_at timestamptz,
  ADD COLUMN IF NOT EXISTS balance_payment_reference text,
  ADD COLUMN IF NOT EXISTS balance_payment_provider text,
  ADD COLUMN IF NOT EXISTS balance_payment_url text,
  ADD COLUMN IF NOT EXISTS balance_reminder_sent_at timestamptz;

-- Soft check on values (use NOT VALID so existing rows are accepted, then validate fresh rows)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'orders_payment_plan_check'
  ) THEN
    ALTER TABLE public.orders
      ADD CONSTRAINT orders_payment_plan_check
      CHECK (payment_plan IN ('full','deposit')) NOT VALID;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'orders_balance_status_check'
  ) THEN
    ALTER TABLE public.orders
      ADD CONSTRAINT orders_balance_status_check
      CHECK (balance_status IN ('not_applicable','pending','paid')) NOT VALID;
  END IF;
END $$;

-- Helpful index for admin filtering pending balances
CREATE INDEX IF NOT EXISTS idx_orders_balance_pending
  ON public.orders (created_at DESC)
  WHERE balance_status = 'pending';

COMMENT ON COLUMN public.orders.payment_plan IS 'full = pay full amount upfront. deposit = pay 30% upfront, 70% on arrival.';
COMMENT ON COLUMN public.orders.balance_status IS 'not_applicable for full payment; pending until the 70% balance is paid; paid once collected.';
