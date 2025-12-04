-- Add shipping_status column to order_items for item-level tracking
ALTER TABLE public.order_items 
ADD COLUMN IF NOT EXISTS shipping_status text DEFAULT 'pending';

-- Add constraint to ensure valid shipping statuses
ALTER TABLE public.order_items 
ADD CONSTRAINT order_items_shipping_status_check 
CHECK (shipping_status IN ('pending', 'shipped', 'delivered'));

-- Create index for faster status queries
CREATE INDEX IF NOT EXISTS idx_order_items_shipping_status ON public.order_items(shipping_status);

-- Update existing items to have 'pending' status
UPDATE public.order_items SET shipping_status = 'pending' WHERE shipping_status IS NULL;