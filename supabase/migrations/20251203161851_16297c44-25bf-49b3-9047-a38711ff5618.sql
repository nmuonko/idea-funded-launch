-- Add "Save for Later" columns to order_items table
ALTER TABLE public.order_items 
ADD COLUMN IF NOT EXISTS is_saved_for_later boolean NOT NULL DEFAULT false;

ALTER TABLE public.order_items 
ADD COLUMN IF NOT EXISTS saved_at timestamptz;

ALTER TABLE public.order_items 
ADD COLUMN IF NOT EXISTS last_reminder_at timestamptz;

-- Create index for efficient querying of saved items
CREATE INDEX IF NOT EXISTS idx_order_items_saved_for_later 
ON public.order_items (is_saved_for_later) 
WHERE is_saved_for_later = true;

-- Create index for reminder queries
CREATE INDEX IF NOT EXISTS idx_order_items_saved_reminder 
ON public.order_items (saved_at, last_reminder_at) 
WHERE is_saved_for_later = true;