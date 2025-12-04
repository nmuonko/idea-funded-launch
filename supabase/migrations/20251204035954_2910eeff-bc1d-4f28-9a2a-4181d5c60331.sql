-- Add confirmation_code to maisha_payments table
ALTER TABLE public.maisha_payments 
ADD COLUMN IF NOT EXISTS confirmation_code text UNIQUE,
ADD COLUMN IF NOT EXISTS maishapay_status text,
ADD COLUMN IF NOT EXISTS maishapay_description text,
ADD COLUMN IF NOT EXISTS maishapay_transaction_ref_id text,
ADD COLUMN IF NOT EXISTS maishapay_operator_ref_id text,
ADD COLUMN IF NOT EXISTS raw_query jsonb,
ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id);

-- Create index for faster confirmation code lookups
CREATE INDEX IF NOT EXISTS idx_maisha_payments_confirmation_code ON public.maisha_payments(confirmation_code);
CREATE INDEX IF NOT EXISTS idx_maisha_payments_user_id ON public.maisha_payments(user_id);
CREATE INDEX IF NOT EXISTS idx_maisha_payments_transaction_ref ON public.maisha_payments(maishapay_transaction_ref_id);

-- Drop existing policy if exists and recreate
DROP POLICY IF EXISTS "Users can view payments by confirmation code" ON public.maisha_payments;
CREATE POLICY "Users can view payments by confirmation code"
ON public.maisha_payments
FOR SELECT
USING (
  confirmation_code IS NOT NULL AND
  EXISTS (
    SELECT 1 FROM orders 
    WHERE orders.id = maisha_payments.order_id 
    AND orders.user_id = auth.uid()
  )
);