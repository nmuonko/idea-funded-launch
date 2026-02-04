-- Fix checkout_sessions constraints for CHOICE_REQUIRED payment flow

-- 1. Update pay_method constraint to include BANK_TRANSFER and CHOICE_REQUIRED
ALTER TABLE checkout_sessions DROP CONSTRAINT IF EXISTS checkout_sessions_pay_method_check;
ALTER TABLE checkout_sessions ADD CONSTRAINT checkout_sessions_pay_method_check 
  CHECK (pay_method = ANY (ARRAY['CARD'::text, 'MOBILE_MONEY'::text, 'BANK_TRANSFER'::text, 'CHOICE_REQUIRED'::text]));

-- 2. Update status constraint to include choice_required
ALTER TABLE checkout_sessions DROP CONSTRAINT IF EXISTS checkout_sessions_status_check;
ALTER TABLE checkout_sessions ADD CONSTRAINT checkout_sessions_status_check 
  CHECK (status = ANY (ARRAY[
    'awaiting_provider_selection'::text, 
    'provider_selected'::text, 
    'initiated'::text, 
    'pending'::text, 
    'processing'::text, 
    'paid'::text, 
    'failed'::text, 
    'cancelled'::text, 
    'expired'::text, 
    'choice_required'::text
  ]));