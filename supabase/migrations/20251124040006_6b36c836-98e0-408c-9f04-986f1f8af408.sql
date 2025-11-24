-- Add validation function for minimum payment amount
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
$$ LANGUAGE plpgsql;

-- Create trigger to validate payment amount on insert and update
DROP TRIGGER IF EXISTS validate_payment_amount_trigger ON public.user_submissions;
CREATE TRIGGER validate_payment_amount_trigger
BEFORE INSERT OR UPDATE ON public.user_submissions
FOR EACH ROW
EXECUTE FUNCTION validate_payment_amount();

COMMENT ON FUNCTION validate_payment_amount() IS 'Validates that payment_amount and amount_due are at least $20';
