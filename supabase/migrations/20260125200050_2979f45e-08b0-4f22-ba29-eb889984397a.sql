-- ============================================
-- Payment State Machine & Provider Gating Migration
-- Prevents auto-charging on "Pay Now" click
-- ============================================

-- 1. Add selected_provider column to checkout_sessions
ALTER TABLE public.checkout_sessions 
  ADD COLUMN IF NOT EXISTS selected_provider TEXT;

-- 2. Drop existing status constraint if exists
ALTER TABLE public.checkout_sessions 
  DROP CONSTRAINT IF EXISTS checkout_sessions_status_check;

-- 3. Add new status constraint with awaiting_provider_selection
ALTER TABLE public.checkout_sessions 
  ADD CONSTRAINT checkout_sessions_status_check 
  CHECK (status = ANY (ARRAY[
    'awaiting_provider_selection',
    'provider_selected', 
    'initiated', 
    'pending', 
    'processing',
    'paid', 
    'failed', 
    'cancelled', 
    'expired'
  ]));

-- 4. Change default status to awaiting_provider_selection
ALTER TABLE public.checkout_sessions 
  ALTER COLUMN status SET DEFAULT 'awaiting_provider_selection';

-- 5. Add provider_triggered_at timestamp to track when provider API was called
ALTER TABLE public.checkout_sessions 
  ADD COLUMN IF NOT EXISTS provider_triggered_at TIMESTAMPTZ;

-- 6. Create partial unique index on payment_attempts for idempotency
-- Only one active attempt per order+provider combination
DROP INDEX IF EXISTS idx_payment_attempts_unique_active;
CREATE UNIQUE INDEX idx_payment_attempts_unique_active 
  ON public.payment_attempts (order_id, provider) 
  WHERE status IN ('pending', 'processing', 'paid');

-- 7. Add comment for documentation
COMMENT ON COLUMN public.checkout_sessions.selected_provider IS 
  'Provider explicitly selected by user (pawapay, stripe, bank_transfer). NULL means awaiting selection.';

COMMENT ON COLUMN public.checkout_sessions.provider_triggered_at IS 
  'Timestamp when provider API was actually called. Used for audit trail.';

COMMENT ON INDEX idx_payment_attempts_unique_active IS 
  'Ensures only one active payment attempt per order+provider for idempotency.';