-- Add unique constraint on cart_item_id (renamed from order_item_id in schema but used as cart_item_id)
-- First, delete any duplicate rows keeping only the most recent one
DELETE FROM price_confirmations a
USING price_confirmations b
WHERE a.cart_item_id = b.cart_item_id
  AND a.cart_item_id IS NOT NULL
  AND a.id < b.id;

-- Now add unique constraint
ALTER TABLE price_confirmations 
ADD CONSTRAINT price_confirmations_cart_item_id_unique UNIQUE(cart_item_id);

-- Ensure status values are uppercase (fix any lowercase ones)
UPDATE price_confirmations 
SET status = UPPER(status) 
WHERE status != UPPER(status);

-- Also fix any order_items with lowercase status
UPDATE order_items 
SET price_confirmation_status = UPPER(price_confirmation_status) 
WHERE price_confirmation_status IS NOT NULL 
  AND price_confirmation_status != UPPER(price_confirmation_status);