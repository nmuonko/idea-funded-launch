-- Fix search_path for validate_payment_amount function
CREATE OR REPLACE FUNCTION validate_payment_amount()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.payment_amount IS NOT NULL AND NEW.payment_amount < 20 THEN
    RAISE EXCEPTION 'Minimum payment amount is $20. Received: $%', NEW.payment_amount;
  END IF;
  
  IF NEW.amount_due IS NOT NULL AND NEW.amount_due < 20 THEN
    RAISE EXCEPTION 'Minimum amount due is $20. Received: $%', NEW.amount_due;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

COMMENT ON FUNCTION validate_payment_amount() IS 'Validates that payment_amount and amount_due are at least $20';
