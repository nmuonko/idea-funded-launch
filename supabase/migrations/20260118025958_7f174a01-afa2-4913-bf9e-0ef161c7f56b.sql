-- ================================================================
-- Guest Price Confirmations Support
-- Adds device_id columns and indexes for guest tracking
-- ================================================================

-- 1. Add device_id to price_confirmations (for guest tracking)
ALTER TABLE public.price_confirmations 
ADD COLUMN IF NOT EXISTS device_id text;

-- 2. Make user_id NULLABLE for guest submissions
ALTER TABLE public.price_confirmations 
ALTER COLUMN user_id DROP NOT NULL;

-- 3. Add device_id to order_items (for guest cart linkage)
ALTER TABLE public.order_items 
ADD COLUMN IF NOT EXISTS device_id text;

-- 4. Add indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_price_confirmations_device_id 
ON public.price_confirmations(device_id);

CREATE INDEX IF NOT EXISTS idx_price_confirmations_user_id 
ON public.price_confirmations(user_id);

CREATE INDEX IF NOT EXISTS idx_order_items_device_id 
ON public.order_items(device_id);

-- 5. Add constraint to ensure either user_id or device_id is present
ALTER TABLE public.price_confirmations 
ADD CONSTRAINT check_user_or_device 
CHECK (user_id IS NOT NULL OR device_id IS NOT NULL);

-- 6. Ensure consistent uppercase status values for existing records
UPDATE public.price_confirmations 
SET status = UPPER(status) 
WHERE status != UPPER(status);

UPDATE public.order_items 
SET price_confirmation_status = UPPER(price_confirmation_status) 
WHERE price_confirmation_status IS NOT NULL 
AND price_confirmation_status != UPPER(price_confirmation_status);