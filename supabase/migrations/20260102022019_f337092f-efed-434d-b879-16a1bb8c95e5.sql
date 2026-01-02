-- Add price_confirmation_status to order_items for cart item status tracking
ALTER TABLE public.order_items 
ADD COLUMN IF NOT EXISTS price_confirmation_status text DEFAULT NULL 
CHECK (price_confirmation_status IN ('PENDING', 'APPROVED', 'ADJUSTED', 'REJECTED'));

-- Add admin_adjusted_price to store the admin-approved/adjusted price
ALTER TABLE public.order_items 
ADD COLUMN IF NOT EXISTS admin_adjusted_price numeric(12,2) DEFAULT NULL;

-- Add price_confirmation_id to link cart item to price_confirmations table
ALTER TABLE public.order_items 
ADD COLUMN IF NOT EXISTS price_confirmation_id uuid DEFAULT NULL REFERENCES public.price_confirmations(id);

-- Add index for efficient lookup by price confirmation status
CREATE INDEX IF NOT EXISTS idx_order_items_price_confirmation_status 
ON public.order_items(price_confirmation_status) WHERE price_confirmation_status IS NOT NULL;

-- Add index on price_confirmations for cart_item_id lookups
CREATE INDEX IF NOT EXISTS idx_price_confirmations_cart_item_id 
ON public.price_confirmations(cart_item_id) WHERE cart_item_id IS NOT NULL;

-- Enable realtime for price_confirmations (if not already)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' 
    AND schemaname = 'public' 
    AND tablename = 'price_confirmations'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.price_confirmations;
  END IF;
END $$;