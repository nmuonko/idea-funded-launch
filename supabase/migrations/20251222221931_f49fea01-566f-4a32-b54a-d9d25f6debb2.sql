-- Step 1: Add cart versioning to orders table
-- This allows detection of cart changes between client and server

-- Add cart_version column with default 1
ALTER TABLE public.orders 
ADD COLUMN IF NOT EXISTS cart_version integer NOT NULL DEFAULT 1;

-- Create function to auto-increment cart_version on order_items changes
CREATE OR REPLACE FUNCTION public.increment_cart_version()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Increment cart_version when items are added, updated, or deleted
  IF TG_OP = 'DELETE' THEN
    UPDATE public.orders 
    SET cart_version = cart_version + 1, updated_at = now()
    WHERE id = OLD.order_id AND status = 'DRAFT';
    RETURN OLD;
  ELSE
    UPDATE public.orders 
    SET cart_version = cart_version + 1, updated_at = now()
    WHERE id = NEW.order_id AND status = 'DRAFT';
    RETURN NEW;
  END IF;
END;
$$;

-- Create triggers to auto-increment cart_version on order_items changes
DROP TRIGGER IF EXISTS trigger_increment_cart_version_insert ON public.order_items;
DROP TRIGGER IF EXISTS trigger_increment_cart_version_update ON public.order_items;
DROP TRIGGER IF EXISTS trigger_increment_cart_version_delete ON public.order_items;

CREATE TRIGGER trigger_increment_cart_version_insert
  AFTER INSERT ON public.order_items
  FOR EACH ROW
  EXECUTE FUNCTION public.increment_cart_version();

CREATE TRIGGER trigger_increment_cart_version_update
  AFTER UPDATE ON public.order_items
  FOR EACH ROW
  EXECUTE FUNCTION public.increment_cart_version();

CREATE TRIGGER trigger_increment_cart_version_delete
  AFTER DELETE ON public.order_items
  FOR EACH ROW
  EXECUTE FUNCTION public.increment_cart_version();

-- Add index for faster lookups
CREATE INDEX IF NOT EXISTS idx_orders_cart_version ON public.orders(id, cart_version) WHERE status = 'DRAFT';