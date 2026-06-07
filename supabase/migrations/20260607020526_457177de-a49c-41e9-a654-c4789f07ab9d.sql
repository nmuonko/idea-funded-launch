ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'full';

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'payments_kind_check'
  ) THEN
    ALTER TABLE public.payments
      ADD CONSTRAINT payments_kind_check
      CHECK (kind IN ('full','deposit','balance')) NOT VALID;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_payments_order_kind
  ON public.payments (order_id, kind);

COMMENT ON COLUMN public.payments.kind IS 'full = single full-amount payment; deposit = 30% upfront; balance = remaining 70% paid on arrival.';
